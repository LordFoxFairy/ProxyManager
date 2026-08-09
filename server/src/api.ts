import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { COLLECT_INTERVAL, RECHECK_INTERVAL, SCORE, VALIDATE_BATCH } from './config.js';
import { collect } from './core/collect.js';
import { gatewayStats, traffic } from './core/gateway.js';
import { picker } from './core/picker.js';
import * as store from './core/store.js';
import { run as validate } from './core/validate.js';

type Phase = 'idle' | 'collecting' | 'validating';

const state = {
  running: false,
  phase: 'idle' as Phase,
  lastRun: null as number | null,
  lastError: null as string | null,
  log: [] as string[],
};

function note(m: string) {
  console.log(m);
  state.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`);
  if (state.log.length > 200) state.log.shift();
}

const wire = (p: store.Proxy) => ({
  url: `${p.scheme}://${p.addr}`,
  addr: p.addr,
  scheme: p.scheme,
  score: p.score,
  anonymity: p.anonymity,
  country: p.country,
  https: Boolean(p.https),
  latencyMs: p.latency_ms,
  okCount: p.ok_count,
  failCount: p.fail_count,
  source: p.source,
  checkedAt: p.checked_at,
});

const query = (c: { req: { query: (k: string) => string | undefined } }) => ({
  n: Number(c.req.query('n') ?? 1),
  scheme: c.req.query('scheme'),
  minScore: Number(c.req.query('min_score') ?? 1),
  country: c.req.query('country'),
  anonymity: c.req.query('anonymity'),
  https: c.req.query('https') === 'true',
});

export const app = new Hono();

// The Tauri webview is a cross-origin caller; the server binds to loopback.
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.get('/proxy', (c) => {
  const rows = store.get({ ...query(c), n: 1 });
  if (!rows.length) return c.json({ error: 'no proxy available' }, 404);
  return c.json(wire(rows[0]!));
});

app.get('/proxies', (c) => {
  const rows = store.get({ ...query(c), n: Number(c.req.query('n') ?? 10) });
  return c.json({ count: rows.length, proxies: rows.map(wire) });
});

app.get('/stats', (c) =>
  c.json({
    ...store.stats(),
    running: state.running,
    phase: state.phase,
    lastRun: state.lastRun,
    lastError: state.lastError,
  }),
);

app.get('/log', (c) => c.json({ lines: state.log }));

/** Local forwarding proxy: status, recent traffic, and strategy controls. */
app.get('/gateway', (c) =>
  c.json({
    ...gatewayStats,
    strategy: picker.strategy,
    tolerance: picker.tolerance,
    rotateAfter: picker.rotateAfter,
    active: picker.active ? `${picker.active.scheme}://${picker.active.addr}` : null,
    traffic: traffic().slice(0, 30),
  }),
);

app.post('/gateway/strategy', (c) => {
  const s = c.req.query('strategy');
  if (s && ['url-test', 'round-robin', 'random'].includes(s)) {
    picker.strategy = s as typeof picker.strategy;
  }
  const tol = Number(c.req.query('tolerance'));
  if (Number.isFinite(tol) && tol >= 0) picker.tolerance = tol;
  const rot = Number(c.req.query('rotate_after'));
  if (Number.isFinite(rot) && rot >= 0) picker.rotateAfter = rot;
  return c.json({ strategy: picker.strategy, tolerance: picker.tolerance, rotateAfter: picker.rotateAfter });
});

/**
 * Consumer feedback. Passing a validator is not proof that real traffic works,
 * so reports carry more weight than checks and are what keeps the pool honest.
 */
app.post('/report', async (c) => {
  const addr = c.req.query('addr');
  if (!addr) return c.json({ error: 'addr required' }, 400);
  const ok = c.req.query('ok') !== 'false';
  store.recordResult(addr, ok, { delta: ok ? SCORE.reportOk : SCORE.reportFail });
  return c.json({ ok: true });
});

app.delete('/proxy/:addr', (c) => {
  const addr = c.req.param('addr');
  if (!store.remove(addr)) return c.json({ error: 'not found' }, 404);
  return c.json({ deleted: addr });
});

app.post('/refresh', (c) => {
  if (state.running) return c.json({ error: 'a run is already in progress' }, 409);
  void cycle(c.req.query('collect') !== 'false');
  return c.json({ started: true });
});

export async function cycle(collectFirst = true, limit = VALIDATE_BATCH) {
  if (state.running) return;
  state.running = true;
  state.lastError = null;
  try {
    if (collectFirst) {
      state.phase = 'collecting';
      await collect(note);
    }
    state.phase = 'validating';
    await validate(limit, note);
  } catch (e) {
    state.lastError = (e as Error).message;
    note(`cycle failed: ${state.lastError}`);
  } finally {
    state.running = false;
    state.phase = 'idle';
    state.lastRun = Date.now();
  }
}

/**
 * Re-checking matters more than collecting: free proxies die within minutes, so
 * a stale pool is worse than a small one.
 */
export function startLoop() {
  let sinceCollect = COLLECT_INTERVAL;
  const tick = async () => {
    const doCollect = sinceCollect >= COLLECT_INTERVAL;
    await cycle(doCollect);
    sinceCollect = doCollect ? 0 : sinceCollect + RECHECK_INTERVAL;
  };
  void tick();
  return setInterval(tick, RECHECK_INTERVAL);
}
