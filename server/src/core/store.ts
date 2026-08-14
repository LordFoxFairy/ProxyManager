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
  exit_ip: string | null;
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
      exit_ip     TEXT,
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

    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS job_runs (
      id          TEXT PRIMARY KEY,
      kind        TEXT NOT NULL,
      status      TEXT NOT NULL,
      started_at  INTEGER NOT NULL,
      finished_at INTEGER,
      error       TEXT,
      metadata    TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_started ON job_runs(started_at DESC);

    CREATE TABLE IF NOT EXISTS proxy_connectivity (
      proxy_addr  TEXT    NOT NULL,
      target_id   TEXT    NOT NULL,
      target_name TEXT    NOT NULL,
      target_url  TEXT    NOT NULL,
      available   INTEGER NOT NULL,
      latency_ms  INTEGER,
      status_code INTEGER,
      checked_at  INTEGER NOT NULL,
      PRIMARY KEY (proxy_addr, target_id)
    );
    CREATE INDEX IF NOT EXISTS idx_connectivity_target
      ON proxy_connectivity(target_id, available, proxy_addr);
  `);

  // Existing databases predate exit_ip; keep migrations additive and cheap.
  const proxyColumns = db.pragma('table_info(proxies)') as { name: string }[];
  if (!proxyColumns.some((column) => column.name === 'exit_ip')) {
    db.exec('ALTER TABLE proxies ADD COLUMN exit_ip TEXT');
  }
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
  exitIp?: string | null;
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
         exit_ip    = COALESCE(?, exit_ip),
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
      patch.exitIp ?? null,
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
  exitIp?: boolean;
  target?: string;
  search?: string;
  offset?: number;
}

function filters(q: Query) {
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
  if (q.exitIp) where.push('exit_ip IS NOT NULL');
  if (q.target) {
    where.push(
      `EXISTS (SELECT 1 FROM proxy_connectivity pc
               WHERE pc.proxy_addr = proxies.addr AND pc.target_id = ? AND pc.available = 1)`,
    );
    args.push(q.target);
  }
  if (q.search) {
    where.push('(addr LIKE ? OR exit_ip LIKE ?)');
    args.push(`%${q.search}%`, `%${q.search}%`);
  }
  return { where, args };
}

export function get(q: Query = {}): Proxy[] {
  const { where, args } = filters(q);
  args.push(Math.max(1, Math.min(q.n ?? 1, 500)));
  args.push(Math.max(0, Math.floor(q.offset ?? 0)));
  return conn()
    .prepare(
      `SELECT * FROM proxies WHERE ${where.join(' AND ')}
       ORDER BY score DESC, latency_ms ASC LIMIT ? OFFSET ?`,
    )
    .all(...args) as Proxy[];
}

export function count(q: Query = {}): number {
  const { where, args } = filters(q);
  const row = conn()
    .prepare(`SELECT COUNT(*) count FROM proxies WHERE ${where.join(' AND ')}`)
    .get(...args) as { count: number };
  return row.count;
}

export function remove(addr: string): number {
  const d = conn();
  return d.transaction(() => {
    d.prepare('DELETE FROM proxy_connectivity WHERE proxy_addr = ?').run(addr);
    return d.prepare('DELETE FROM proxies WHERE addr = ?').run(addr).changes;
  })();
}

export function restoreProxy(proxy: Proxy, results: StoredConnectivity[] = []): void {
  const d = conn();
  d.transaction(() => {
    d.prepare(`INSERT OR REPLACE INTO proxies
      (addr, scheme, score, anonymity, country, exit_ip, https, latency_ms, ok_count, fail_count, source, checked_at, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      proxy.addr, proxy.scheme, proxy.score, proxy.anonymity, proxy.country, proxy.exit_ip,
      proxy.https, proxy.latency_ms, proxy.ok_count, proxy.fail_count, proxy.source, proxy.checked_at, proxy.added_at,
    );
    const stmt = d.prepare(`INSERT OR REPLACE INTO proxy_connectivity
      (proxy_addr, target_id, target_name, target_url, available, latency_ms, status_code, checked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const result of results) stmt.run(proxy.addr, result.id, result.name, result.url, result.available ? 1 : 0, result.latencyMs, result.statusCode, result.checkedAt);
  })();
}

export const find = (addr: string): Proxy | null =>
  (conn().prepare('SELECT * FROM proxies WHERE addr = ?').get(addr) as Proxy | undefined) ?? null;

export function getSetting(key: string): string | null {
  const row = conn().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  conn()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function removeSetting(key: string): void {
  conn().prepare('DELETE FROM app_settings WHERE key = ?').run(key);
}

export function listSettingKeys(prefix: string): string[] {
  return (conn().prepare('SELECT key FROM app_settings WHERE key LIKE ?').all(`${prefix}%`) as { key: string }[]).map((row) => row.key);
}

export interface JobRun { id: string; kind: 'collect' | 'validate'; status: 'running' | 'success' | 'failed'; startedAt: number; finishedAt: number | null; error: string | null; metadata: Record<string, unknown>; }
export function startJobRun(kind: JobRun['kind'], metadata: Record<string, unknown> = {}): string {
  const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  conn().prepare('INSERT INTO job_runs (id, kind, status, started_at, metadata) VALUES (?, ?, ?, ?, ?)').run(id, kind, 'running', Date.now(), JSON.stringify(metadata));
  return id;
}
export function finishJobRun(id: string, status: Exclude<JobRun['status'], 'running'>, error: string | null = null): void { conn().prepare('UPDATE job_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?').run(status, Date.now(), error, id); }
export function listJobRuns(limit = 50): JobRun[] {
  const rows = conn().prepare('SELECT id, kind, status, started_at, finished_at, error, metadata FROM job_runs ORDER BY started_at DESC LIMIT ?').all(Math.max(1, Math.min(limit, 200))) as { id: string; kind: JobRun['kind']; status: JobRun['status']; started_at: number; finished_at: number | null; error: string | null; metadata: string }[];
  return rows.map((row) => ({ id: row.id, kind: row.kind, status: row.status, startedAt: row.started_at, finishedAt: row.finished_at, error: row.error, metadata: (() => { try { return JSON.parse(row.metadata) as Record<string, unknown>; } catch { return {}; } })() }));
}

export interface ConnectivityPatch {
  id: string;
  name: string;
  url: string;
  available: boolean;
  latencyMs: number | null;
  statusCode: number | null;
}

export function recordConnectivity(addr: string, results: ConnectivityPatch[], checkedAt = Date.now()): void {
  const stmt = conn().prepare(
    `INSERT INTO proxy_connectivity
       (proxy_addr, target_id, target_name, target_url, available, latency_ms, status_code, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(proxy_addr, target_id) DO UPDATE SET
       target_name = excluded.target_name,
       target_url = excluded.target_url,
       available = excluded.available,
       latency_ms = excluded.latency_ms,
       status_code = excluded.status_code,
       checked_at = excluded.checked_at`,
  );
  conn().transaction((rows: ConnectivityPatch[]) => {
    for (const result of rows) {
      stmt.run(
        addr,
        result.id,
        result.name,
        result.url,
        result.available ? 1 : 0,
        result.latencyMs,
        result.statusCode,
        checkedAt,
      );
    }
  })(results);
}

export interface ConnectivitySummary {
  available: number;
  total: number;
  checkedAt: number;
}

export function connectivitySummaries(addrs: string[]): Map<string, ConnectivitySummary> {
  if (!addrs.length) return new Map();
  const placeholders = addrs.map(() => '?').join(',');
  const rows = conn()
    .prepare(
      `SELECT proxy_addr, SUM(available) available, COUNT(*) total, MAX(checked_at) checked_at
       FROM proxy_connectivity WHERE proxy_addr IN (${placeholders}) GROUP BY proxy_addr`,
    )
    .all(...addrs) as { proxy_addr: string; available: number; total: number; checked_at: number }[];
  return new Map(rows.map((row) => [row.proxy_addr, {
    available: row.available,
    total: row.total,
    checkedAt: row.checked_at,
  }]));
}

export interface StoredConnectivity {
  id: string;
  name: string;
  url: string;
  available: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  checkedAt: number;
}

export function connectivityResults(addr: string): StoredConnectivity[] {
  const rows = conn()
    .prepare(
      `SELECT target_id, target_name, target_url, available, latency_ms, status_code, checked_at
       FROM proxy_connectivity WHERE proxy_addr = ? ORDER BY checked_at DESC, target_name ASC`,
    )
    .all(addr) as {
      target_id: string;
      target_name: string;
      target_url: string;
      available: number;
      latency_ms: number | null;
      status_code: number | null;
      checked_at: number;
    }[];
  return rows.map((row) => ({
    id: row.target_id,
    name: row.target_name,
    url: row.target_url,
    available: Boolean(row.available),
    latencyMs: row.latency_ms,
    statusCode: row.status_code,
    checkedAt: row.checked_at,
  }));
}

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
    d.prepare(
      `DELETE FROM proxy_connectivity
       WHERE proxy_addr IN (SELECT addr FROM proxies WHERE score <= 0 AND checked_at IS NOT NULL)`,
    ).run();
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
