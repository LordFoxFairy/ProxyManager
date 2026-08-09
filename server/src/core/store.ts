import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DB_PATH, SCORE } from '../config.js';

export type Scheme = 'http' | 'socks4' | 'socks5';
export type Anonymity = 'transparent' | 'anonymous' | 'elite';

export interface Proxy {
  addr: string;
  scheme: Scheme;
  score: number;
  anonymity: Anonymity | null;
  country: string | null;
  https: number;
  latency_ms: number | null;
  ok_count: number;
  fail_count: number;
  source: string | null;
  checked_at: number | null;
  added_at: number;
}

let db: Database.Database;

export function init(): Database.Database {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  // WAL lets the API read while the validator writes.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS proxies (
      addr        TEXT PRIMARY KEY,
      scheme      TEXT    NOT NULL,
      score       INTEGER NOT NULL,
      anonymity   TEXT,
      country     TEXT,
      https       INTEGER NOT NULL DEFAULT 0,
      latency_ms  INTEGER,
      ok_count    INTEGER NOT NULL DEFAULT 0,
      fail_count  INTEGER NOT NULL DEFAULT 0,
      source      TEXT,
      checked_at  INTEGER,
      added_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_live ON proxies(score DESC, latency_ms ASC);
    CREATE INDEX IF NOT EXISTS idx_due  ON proxies(checked_at);

    -- Addresses proven dead. The free lists barely change between refreshes, so
    -- without this the same ~70% of dead proxies is re-inserted and re-checked
    -- every cycle, consuming most of the validation budget forever.
    -- Expiry flips the active flag instead of deleting: the row carries the
    -- death count that drives the backoff, so removing it would reset a
    -- chronically dead host to a fresh 1h tombstone every time.
    CREATE TABLE IF NOT EXISTS graveyard (
      addr    TEXT PRIMARY KEY,
      died_at INTEGER NOT NULL,
      deaths  INTEGER NOT NULL DEFAULT 1,
      active  INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_died ON graveyard(active, died_at);
  `);
  return db;
}

const conn = () => db ?? init();

export function addCandidates(rows: { addr: string; scheme: string; source: string }[]): number {
  const d = conn();
  // Skip addresses still under a tombstone -- see purgeDead/exhumeExpired.
  const stmt = d.prepare(
    `INSERT OR IGNORE INTO proxies (addr, scheme, score, source, added_at)
     SELECT ?, ?, ?, ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM graveyard g WHERE g.addr = ? AND g.active = 1)`,
  );
  const now = Date.now();
  // One transaction for ~5k inserts; individually this takes seconds.
  const run = d.transaction((items: typeof rows) => {
    let added = 0;
    for (const r of items) {
      added += stmt.run(r.addr, r.scheme, SCORE.init, r.source, now, r.addr).changes;
    }
    return added;
  });
  return run(rows);
}

/** Due for a check: never-checked first, then least-recently checked. */
export function pending(limit: number): { addr: string; scheme: Scheme }[] {
  return conn()
    .prepare(
      `SELECT addr, scheme FROM proxies WHERE score > 0
       ORDER BY checked_at IS NOT NULL, checked_at ASC LIMIT ?`,
    )
    .all(limit) as { addr: string; scheme: Scheme }[];
}

export interface ResultPatch {
  anonymity?: Anonymity | null;
  country?: string | null;
  latencyMs?: number | null;
  https?: number | null;
  delta?: number;
}

/**
 * Apply a score delta and refresh metadata.
 *
 * The unproven-failure rule is expressed as a CASE inside the UPDATE so the
 * decision reads ok_count in the same statement -- no read-modify-write race.
 */
export function recordResult(addr: string, ok: boolean, patch: ResultPatch = {}): void {
  const deltaExpr =
    patch.delta !== undefined
      ? String(patch.delta | 0)
      : ok
        ? String(SCORE.ok)
        : `CASE WHEN ok_count = 0 THEN ${SCORE.failUnproven} ELSE ${SCORE.fail} END`;

  conn()
    .prepare(
      `UPDATE proxies SET
         score      = MAX(0, MIN(${SCORE.max}, score + (${deltaExpr}))),
         ok_count   = ok_count   + ?,
         fail_count = fail_count + ?,
         anonymity  = COALESCE(?, anonymity),
         country    = COALESCE(?, country),
         latency_ms = COALESCE(?, latency_ms),
         https      = COALESCE(?, https),
         checked_at = ?
       WHERE addr = ?`,
    )
    .run(
      ok ? 1 : 0,
      ok ? 0 : 1,
      patch.anonymity ?? null,
      patch.country ?? null,
      patch.latencyMs ?? null,
      patch.https ?? null,
      Date.now(),
      addr,
    );
}

export interface Query {
  n?: number;
  scheme?: string;
  minScore?: number;
  country?: string;
  anonymity?: string;
  https?: boolean;
}

export function get(q: Query = {}): Proxy[] {
  const where = ['score >= ?', 'checked_at IS NOT NULL'];
  const args: (string | number)[] = [q.minScore ?? 1];
  for (const [col, val] of [
    ['scheme', q.scheme],
    ['country', q.country],
    ['anonymity', q.anonymity],
  ] as const) {
    if (val) {
      where.push(`${col} = ?`);
      args.push(val);
    }
  }
  if (q.https) where.push('https = 1');
  args.push(Math.min(q.n ?? 1, 500));
  return conn()
    .prepare(
      `SELECT * FROM proxies WHERE ${where.join(' AND ')}
       ORDER BY score DESC, latency_ms ASC LIMIT ?`,
    )
    .all(...args) as Proxy[];
}

export const remove = (addr: string): number =>
  conn().prepare('DELETE FROM proxies WHERE addr = ?').run(addr).changes;

/**
 * Drop proxies that hit 0 after being checked, recording each in the graveyard
 * so the next collect does not resurrect it immediately.
 */
export function purgeDead(): number {
  const d = conn();
  const run = d.transaction(() => {
    d.prepare(
      `INSERT INTO graveyard (addr, died_at, deaths, active)
         SELECT addr, ?, 1, 1 FROM proxies WHERE score <= 0 AND checked_at IS NOT NULL
       ON CONFLICT(addr) DO UPDATE
         SET died_at = excluded.died_at, deaths = deaths + 1, active = 1`,
    ).run(Date.now());
    return d
      .prepare('DELETE FROM proxies WHERE score <= 0 AND checked_at IS NOT NULL')
      .run().changes;
  });
  return run();
}

/**
 * Let long-buried addresses be retried. Free proxies do come back, so a
 * tombstone is temporary -- but each additional death doubles the wait
 * (1h, 2h, 4h... capped at 24h) so chronically dead hosts fade out.
 */
export function exhumeExpired(now = Date.now()): number {
  return conn()
    .prepare(
      `UPDATE graveyard SET active = 0
       WHERE active = 1
         AND ? - died_at > MIN(3600000 * (1 << MIN(deaths - 1, 5)), 86400000)`,
    )
    .run(now).changes;
}

export const graveyardSize = (): number =>
  (conn().prepare('SELECT COUNT(*) c FROM graveyard WHERE active = 1').get() as { c: number }).c;

export const isBuried = (addr: string): boolean =>
  conn().prepare('SELECT 1 FROM graveyard WHERE addr = ? AND active = 1').get(addr) !== undefined;

export function stats() {
  const d = conn();
  const row = d
    .prepare(
      `SELECT COUNT(*) total,
              SUM(checked_at IS NULL) unchecked,
              SUM(score > 0 AND checked_at IS NOT NULL) live,
              SUM(score > 0 AND checked_at IS NOT NULL AND https = 1) live_https,
              AVG(CASE WHEN score > 0 AND checked_at IS NOT NULL THEN latency_ms END) avg_latency
       FROM proxies`,
    )
    .get() as Record<string, number | null>;

  const groupBy = (col: string) =>
    Object.fromEntries(
      (
        d
          .prepare(
            `SELECT ${col} k, COUNT(*) c FROM proxies
             WHERE score > 0 AND checked_at IS NOT NULL GROUP BY 1 ORDER BY c DESC`,
          )
          .all() as { k: string | null; c: number }[]
      ).map((r) => [r.k ?? '?', r.c]),
    );

  return {
    total: row.total ?? 0,
    live: row.live ?? 0,
    liveHttps: row.live_https ?? 0,
    unchecked: row.unchecked ?? 0,
    buried: graveyardSize(),
    avgLatency: row.avg_latency ? Math.round(row.avg_latency) : null,
    byScheme: groupBy('scheme'),
    byAnonymity: groupBy('anonymity'),
    byCountry: groupBy('country'),
    bySource: (
      d
        .prepare(
          `SELECT source k, COUNT(*) total,
                  SUM(score > 0 AND checked_at IS NOT NULL) live
           FROM proxies GROUP BY 1 ORDER BY live DESC`,
        )
        .all() as { k: string | null; total: number; live: number | null }[]
    ).map((r) => ({ source: r.k ?? '?', total: r.total, live: r.live ?? 0 })),
  };
}
