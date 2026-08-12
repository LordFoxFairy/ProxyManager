import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
  CHECK_TIMEOUT,
  CONCURRENCY,
  ECHO_ENDPOINTS,
  GEO_BATCH_URL,
  HTTPS_CHECK_URL,
  TCP_CHECK_TIMEOUT,
  TCP_CONCURRENCY,
} from '../config.js';
import { getAutomationSettings } from './control.js';
import { type Anonymity, type Scheme, pending, purgeDead, recordResult } from './store.js';
import type { ValidationProgress } from '../contracts/jobs.js';

/** Headers that leak the client, or announce that a proxy is in the path. */
const LEAK_HEADERS = ['x-forwarded-for', 'x-real-ip', 'client-ip', 'forwarded'];
const PROXY_HEADERS = ['via', 'proxy-connection', 'x-proxy-id'];

function agentFor(scheme: Scheme, addr: string) {
  return scheme === 'http'
    ? new HttpsProxyAgent(`http://${addr}`)
    : new SocksProxyAgent(`${scheme}://${addr}`);
}

interface Res {
  status: number | null;
  body: string;
}

function request(url: string, agent: http.Agent | https.Agent): Promise<Res> {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    let settled = false;
    const done = (status: number | null, body = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req.destroy();
      resolve({ status, body });
    };

    // Node's `timeout` option only fires on socket inactivity, so a proxy that
    // trickles bytes can run far past it -- observed at 26s against an 8s
    // setting. This wall-clock deadline is the real ceiling, and it doubles as
    // a quality filter: anything slower is not worth keeping.
    const deadline = setTimeout(() => done(null), CHECK_TIMEOUT);

    const req = mod.get(
      url,
      { agent, timeout: CHECK_TIMEOUT, headers: { 'user-agent': 'curl/8.7.1' } },
      (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
          // Nothing we parse is large; a hostile endpoint should not OOM us.
          if (body.length > 64_000) done(null);
        });
        res.on('end', () => done(res.statusCode ?? null, body));
      },
    );
    req.on('timeout', () => done(null));
    req.on('error', () => done(null));
  });
}

/**
 * transparent = leaks our IP; anonymous = announces a proxy; elite = neither.
 *
 * `baseline` holds headers the echo service itself injects (ifconfig.me and
 * httpbingo both sit behind proxies and add their own Via/X-Forwarded-For).
 * Counting those would label every proxy "anonymous".
 * Values may be strings or arrays depending on the service.
 */
export function classify(
  headers: Record<string, unknown>,
  myIp: string,
  baseline: Set<string>,
): Anonymity {
  const flat = new Map<string, string>();
  for (const [k, v] of Object.entries(headers)) {
    flat.set(k.toLowerCase(), Array.isArray(v) ? v.join(' ') : String(v ?? ''));
  }
  if (myIp && LEAK_HEADERS.some((h) => flat.get(h)?.includes(myIp))) return 'transparent';
  const announced = [...LEAK_HEADERS, ...PROXY_HEADERS].some(
    (h) => flat.has(h) && !baseline.has(h),
  );
  return announced ? 'anonymous' : 'elite';
}

function extractIp(body: unknown, field: string): string {
  const v = (body as Record<string, unknown>)?.[field];
  return v ? String(v).split(',')[0]!.trim() : '';
}

export interface Echo {
  url: string;
  ipField: string;
  headers: boolean;
  myIp: string;
  baseline: Set<string>;
}

/**
 * Pick a live echo endpoint and learn our own IP plus the headers it injects.
 * Throws if none respond -- silently mislabelling every proxy is worse than
 * stopping, and in practice these endpoints do go down (httpbin 503,
 * httpbingo 402).
 */
export async function probeEcho(log: (m: string) => void = console.log): Promise<Echo> {
  for (const ep of ECHO_ENDPOINTS) {
    try {
      const res = await fetch(ep.url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'curl/8.7.1' },
      });
      if (!res.ok) {
        log(`  echo ${ep.url}: HTTP ${res.status}, trying next`);
        continue;
      }
      const body = (await res.json()) as Record<string, unknown>;
      const myIp = extractIp(body, ep.ipField);
      if (!myIp) {
        log(`  echo ${ep.url}: no ip field, trying next`);
        continue;
      }
      // ifconfig.me reports headers at the top level; httpbin nests them.
      const hdrs = (body.headers as Record<string, unknown>) ?? body;
      const baseline = new Set(
        [...LEAK_HEADERS, ...PROXY_HEADERS].filter((h) =>
          Object.keys(hdrs).some((k) => k.toLowerCase() === h),
        ),
      );
      log(
        `  echo ${ep.url}: ok (ip ${myIp}, headers=${ep.headers}` +
          `, ignoring ${[...baseline].join(',') || 'none'})`,
      );
      return { ...ep, myIp, baseline };
    } catch (e) {
      log(`  echo ${ep.url}: ${(e as Error).name}, trying next`);
    }
  }
  throw new Error('no working echo endpoint; set PM_CHECK_URLS or check connectivity');
}

export interface CheckResult {
  ok: boolean;
  anonymity?: Anonymity;
  latencyMs?: number;
  https?: number;
  exitIp?: string;
}

export async function checkOne(scheme: Scheme, addr: string, echo: Echo): Promise<CheckResult> {
  const t0 = Date.now();
  let agent: http.Agent;
  try {
    agent = agentFor(scheme, addr) as unknown as http.Agent;
  } catch {
    return { ok: false };
  }

  // Plain HTTP first: an HTTPS CONNECT tunnel hides the headers anonymity
  // detection needs, and misclassifies SOCKS proxies.
  const res = await request(echo.url, agent);
  agent.destroy();
  if (res.status !== 200) return { ok: false };

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(res.body);
  } catch {
    return { ok: false };
  }

  const exitIp = extractIp(body, echo.ipField);
  // A proxy echoing our own IP is not proxying at all.
  if (!exitIp || (echo.myIp && exitIp === echo.myIp)) return { ok: false };

  const latencyMs = Date.now() - t0;

  // Only proxies that already passed are worth a TLS probe. Most real traffic
  // is HTTPS but many SOCKS proxies fail CONNECT, so this is recorded as a
  // separate capability rather than folded into pass/fail.
  const tlsAgent = agentFor(scheme, addr) as unknown as https.Agent;
  const tls = await request(HTTPS_CHECK_URL, tlsAgent);
  tlsAgent.destroy();

  const hdrs = echo.headers
    ? ((body.headers as Record<string, unknown>) ?? body)
    : {};
  return {
    ok: true,
    anonymity: echo.headers ? classify(hdrs, echo.myIp, echo.baseline) : undefined,
    latencyMs,
    https: tls.status === 200 ? 1 : 0,
    exitIp,
  };
}

/** Resolve country for exit IPs. Free, batched 100 at a time, best-effort. */
async function geoLookup(ips: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ips.length; i += 100) {
    const chunk = ips.slice(i, i + 100);
    try {
      const res = await fetch(GEO_BATCH_URL, {
        method: 'POST',
        body: JSON.stringify(chunk),
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      for (const r of (await res.json()) as { status: string; countryCode?: string; query: string }[]) {
        if (r.status === 'success' && r.countryCode) out.set(r.query, r.countryCode);
      }
    } catch {
      // Geo is a nice-to-have; never fail a run over it.
    }
    // ip-api free tier allows ~15 batch req/min.
    if (i + 100 < ips.length) await new Promise((r) => setTimeout(r, 4000));
  }
  return out;
}

async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++]!;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function tcpProbe(addr: string, timeout = TCP_CHECK_TIMEOUT): Promise<boolean> {
  const separator = addr.lastIndexOf(':');
  const host = addr.slice(0, separator);
  const port = Number(addr.slice(separator + 1));
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) return false;

  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      resolve(reachable);
    };
    const deadline = setTimeout(() => done(false), timeout);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/**
 * A healthy public pool does not go from hundreds of proven nodes to zero in
 * one pass. Treat that shape as a validator/upstream outage before mutating
 * scores, otherwise a transient echo-path failure can erase the whole pool.
 */
export function isCatastrophicValidationFailure(checked: number, passed: number): boolean {
  if (checked < 50) return false;
  if (passed === 0) return true;
  return checked >= 500 && passed / checked < 0.005;
}

export async function run(
  limit: number,
  log: (m: string) => void = console.log,
  onProgress: (progress: ValidationProgress) => void = () => {},
) {
  const targets = pending(limit);
  if (!targets.length) {
    log('nothing to check');
    return { checked: 0, passed: 0, purged: 0 };
  }

  let reachable = 0;
  let tcpCompleted = 0;
  const reachableTargets: typeof targets = [];
  onProgress({ stage: 'tcp', total: targets.length, completed: 0, reachable: 0, passed: 0 });
  await pool(targets, TCP_CONCURRENCY, async (target) => {
    if (await tcpProbe(target.addr)) {
      reachable++;
      reachableTargets.push(target);
    }
    tcpCompleted++;
    onProgress({
      stage: 'tcp',
      total: targets.length,
      completed: tcpCompleted,
      reachable,
      passed: 0,
    });
  });
  log(`tcp probe ${reachable}/${targets.length} reachable`);

  const echo = reachableTargets.length ? await probeEcho(log) : null;
  let passed = 0;
  let proxyCompleted = 0;
  const results = new Map<string, CheckResult>();
  for (const target of targets) results.set(target.addr, { ok: false });

  onProgress({
    stage: 'proxy',
    total: reachableTargets.length,
    completed: 0,
    reachable,
    passed,
  });
  await pool(reachableTargets, CONCURRENCY, async (t) => {
    const r = await checkOne(t.scheme, t.addr, echo!);
    results.set(t.addr, r);
    if (r.ok) passed++;
    proxyCompleted++;
    onProgress({
      stage: 'proxy',
      total: reachableTargets.length,
      completed: proxyCompleted,
      reachable,
      passed,
    });
  });

  if (isCatastrophicValidationFailure(targets.length, passed)) {
    const rate = ((passed / targets.length) * 100).toFixed(1);
    log(`validation circuit breaker: ${passed}/${targets.length} passed (${rate}%); pool unchanged`);
    throw new Error('validation circuit breaker: abnormal bulk failure; pool unchanged');
  }

  // Geo only for survivors -- looking up dead proxies wastes the rate limit.
  const liveIps = [...results.values()].filter((r) => r.ok && r.exitIp).map((r) => r.exitIp!);
  onProgress({ stage: 'geo', total: liveIps.length, completed: 0, reachable, passed });
  const geo = liveIps.length ? await geoLookup([...new Set(liveIps)]) : new Map();
  onProgress({ stage: 'geo', total: liveIps.length, completed: liveIps.length, reachable, passed });

  for (const [addr, r] of results) {
    recordResult(addr, r.ok, {
      anonymity: r.anonymity ?? null,
      latencyMs: r.latencyMs ?? null,
      https: r.https ?? null,
      exitIp: r.exitIp ?? null,
      country: r.exitIp ? (geo.get(r.exitIp) ?? null) : null,
    });
  }

  const purged = getAutomationSettings().autoPurgeEnabled ? purgeDead() : 0;
  log(
    `checked ${targets.length}, passed ${passed} ` +
      `(${((passed / targets.length) * 100).toFixed(1)}%), purged ${purged}`,
  );
  return { checked: targets.length, passed, purged };
}
