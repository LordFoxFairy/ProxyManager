import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HOST, PORT, SCORE } from './config.js';
import { JobOrchestrator } from './jobs/job-orchestrator.js';
import { JobScheduler } from './jobs/scheduler.js';
import {
  collect,
  setSourceEnabled,
  sourceExists,
  sourceStatuses,
} from './core/collect.js';
import {
  checkConnectivity,
  checkProxyConnectivity,
  DEFAULT_CONNECTIVITY_TARGETS,
  normalizeConnectivityTargets,
  listCustomConnectivityTargets,
  replaceCustomConnectivityTargets,
} from './core/connectivity.js';
import { getAutomationSettings, updateAutomationSettings } from './core/control.js';
import {
  createBrowserDiagnosticSession,
  getBrowserDiagnosticSession,
  recordBrowserDiagnosticEvidence,
  renderBrowserDiagnosticPage,
} from './core/browser-diagnostics.js';
import { lookupIpProfile } from './core/ip-profile.js';
import { applyRuntimeAction, getRuntimeConfig, getRuntimeStatus, probeRuntimeStatus, rollbackRuntimeConfig, setRuntimeKind, updateRuntimeConfig } from './core/runtime.js';
import { buildMihomoConfig, mihomo, validateMihomoConfig } from './core/mihomo.js';
import { listProviders, removeProvider, refreshProvider, upsertProvider } from './core/providers.js';
import { listGroups, removeGroup, upsertGroup } from './core/groups.js';
import { listRuleProviders, listRules, refreshRuleProvider, removeRule, removeRuleProvider, upsertRule, upsertRuleProvider } from './core/rules.js';
import { exportConfigBundle, importConfigBundle } from './core/config-bundle.js';
import { gatewayStats, traffic } from './core/gateway.js';
import { picker } from './core/picker.js';
import {
  gatewayProfiles,
  getGatewayRouting,
  updateGatewayRouting,
} from './core/routing.js';
import { serviceProfile } from './core/services.js';
import * as store from './core/store.js';
import { run as validate } from './core/validate.js';

const jobs = new JobOrchestrator({
  collect,
  validate,
  sourceStatuses,
  output: console.log,
});
const scheduler = new JobScheduler(jobs, getAutomationSettings);

const wire = (p: store.Proxy) => ({
  url: `${p.scheme}://${p.addr}`,
  addr: p.addr,
  scheme: p.scheme,
  score: p.score,
  anonymity: p.anonymity,
  country: p.country,
  exitIp: p.exit_ip,
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
  target: c.req.query('target'),
  search: c.req.query('search')?.trim() || undefined,
});

export const app = new Hono();

// The Tauri webview is a cross-origin caller; the server binds to loopback.
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true }));

app.get('/runtime', (c) => c.json({ status: getRuntimeStatus(), config: getRuntimeConfig() }));
app.get('/runtime/probe', async (c) => c.json({ status: await probeRuntimeStatus(), config: getRuntimeConfig() }));
const reloadMihomoIfRunning = async () => {
  if (getRuntimeStatus().kind !== 'mihomo' || !mihomo.running) return null;
  await applyRuntimeAction('restart');
  return getRuntimeStatus();
};
async function commitConfigChange<T>(mutate: () => T): Promise<{ value?: T; error?: unknown }> {
  const backup = exportConfigBundle();
  try {
    const value = mutate();
    await reloadMihomoIfRunning();
    return { value };
  } catch (error) {
    try {
      importConfigBundle(backup);
      await reloadMihomoIfRunning();
    } catch { /* preserve the original runtime error */ }
    return { error };
  }
}
app.patch('/runtime', async (c) => {
  let body: unknown = {};
  try { body = await c.req.json(); } catch { /* return current state */ }
  const patch = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const previousKind = getRuntimeStatus().kind;
  const previous = getRuntimeConfig();
  if (patch.kind !== undefined) setRuntimeKind(patch.kind);
  const config = updateRuntimeConfig(patch);
  try {
    await reloadMihomoIfRunning();
    return c.json({ status: getRuntimeStatus(), config });
  } catch (error) {
    updateRuntimeConfig(previous);
    setRuntimeKind(previousKind);
    try { if (mihomo.running) await mihomo.stop(); await mihomo.start(previous); } catch { /* preserve the original failure */ }
    return c.json({ error: error instanceof Error ? error.message : 'Runtime 配置未能生效', status: getRuntimeStatus(), config: previous }, 409);
  }
});
app.post('/runtime/action', async (c) => {
  let body: { action?: unknown } = {};
  try { body = await c.req.json(); } catch { /* invalid action below */ }
  try {
    const status = await applyRuntimeAction(body.action);
    return c.json({ status });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Runtime 操作失败', status: getRuntimeStatus() }, 409);
  }
});
app.post('/runtime/rollback', async (c) => {
  const backup = exportConfigBundle();
  const config = rollbackRuntimeConfig();
  try {
    await reloadMihomoIfRunning();
    return c.json({ status: getRuntimeStatus(), config });
  } catch (error) {
    try { importConfigBundle(backup); await reloadMihomoIfRunning(); } catch { /* preserve the original error */ }
    return c.json({ error: error instanceof Error ? error.message : 'Runtime 回滚失败', status: getRuntimeStatus(), config: backup.runtime }, 409);
  }
});
app.get('/runtime/config-preview', (c) => {
  const config = getRuntimeConfig();
  const errors = validateMihomoConfig(config);
  return c.json({ valid: errors.length === 0, errors, config: buildMihomoConfig(config) });
});
app.get('/config/export', (c) => c.json(exportConfigBundle()));
app.post('/config/import', async (c) => {
  let body: unknown = {};
  try { body = await c.req.json(); } catch {}
  const backup = exportConfigBundle();
  try {
    const bundle = importConfigBundle(body);
    await reloadMihomoIfRunning();
    return c.json(bundle);
  } catch (error) {
    // Import can succeed while the runtime rejects the generated config. Restore
    // the complete pre-import bundle so the control plane and sidecar converge.
    try { importConfigBundle(backup); await reloadMihomoIfRunning(); } catch { /* preserve the original error */ }
    return c.json({ error: error instanceof Error ? error.message : '配置导入失败' }, 400);
  }
});
app.get('/providers', (c) => c.json({ providers: listProviders() }));
app.post('/providers', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const result = await commitConfigChange(() => upsertProvider(body)); return result.error ? c.json({ error: result.error instanceof Error ? result.error.message : 'Provider 保存失败' }, 409) : c.json(result.value); });
app.patch('/providers/:id', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const result = await commitConfigChange(() => upsertProvider({ ...(body as object), id: c.req.param('id') })); return result.error ? c.json({ error: result.error instanceof Error ? result.error.message : 'Provider 保存失败' }, 409) : c.json(result.value); });
app.delete('/providers/:id', async (c) => { const result = await commitConfigChange(() => removeProvider(c.req.param('id'))); if (result.error) return c.json({ error: result.error instanceof Error ? result.error.message : 'Provider 删除失败' }, 409); return result.value ? c.json({ deleted: c.req.param('id') }) : c.json({ error: 'Provider 不存在' }, 404); });
app.post('/providers/:id/refresh', async (c) => { const backup = exportConfigBundle(); let provider; try { provider = await refreshProvider(c.req.param('id')); } catch (error) { return c.json({ error: error instanceof Error ? error.message : 'Provider 更新失败' }, 409); } try { await reloadMihomoIfRunning(); return c.json(provider); } catch (error) { try { importConfigBundle(backup); await reloadMihomoIfRunning(); } catch {} return c.json({ error: error instanceof Error ? error.message : 'Provider 更新失败' }, 409); } });
app.get('/groups', (c) => c.json({ groups: listGroups() }));
app.post('/groups', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const result = await commitConfigChange(() => upsertGroup(body)); return result.error ? c.json({ error: result.error instanceof Error ? result.error.message : '代理组保存失败' }, 409) : c.json(result.value); });
app.patch('/groups/:id', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const result = await commitConfigChange(() => upsertGroup({ ...(body as object), id: c.req.param('id') })); return result.error ? c.json({ error: result.error instanceof Error ? result.error.message : '代理组保存失败' }, 409) : c.json(result.value); });
app.delete('/groups/:id', async (c) => { const result = await commitConfigChange(() => removeGroup(c.req.param('id'))); if (result.error) return c.json({ error: result.error instanceof Error ? result.error.message : '代理组删除失败' }, 409); return result.value ? c.json({ deleted: c.req.param('id') }) : c.json({ error: '代理组不存在或不可删除' }, 409); });
app.get('/rules', (c) => c.json({ rules: listRules() }));
app.post('/rules', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const result = await commitConfigChange(() => upsertRule(body)); return result.error ? c.json({ error: result.error instanceof Error ? result.error.message : '规则保存失败' }, 409) : c.json(result.value); });
app.patch('/rules/:id', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const result = await commitConfigChange(() => upsertRule({ ...(body as object), id: c.req.param('id') })); return result.error ? c.json({ error: result.error instanceof Error ? result.error.message : '规则保存失败' }, 409) : c.json(result.value); });
app.delete('/rules/:id', async (c) => { const result = await commitConfigChange(() => removeRule(c.req.param('id'))); if (result.error) return c.json({ error: result.error instanceof Error ? result.error.message : '规则删除失败' }, 409); return result.value ? c.json({ deleted: c.req.param('id') }) : c.json({ error: '规则不存在' }, 404); });
app.get('/rule-providers', (c) => c.json({ providers: listRuleProviders() }));
app.post('/rule-providers', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const provider = upsertRuleProvider(body); await reloadMihomoIfRunning(); return c.json(provider); });
app.patch('/rule-providers/:id', async (c) => { let body: unknown = {}; try { body = await c.req.json(); } catch {} const provider = upsertRuleProvider({ ...(body as object), id: c.req.param('id') }); await reloadMihomoIfRunning(); return c.json(provider); });
app.delete('/rule-providers/:id', async (c) => { const result = await commitConfigChange(() => removeRuleProvider(c.req.param('id'))); if (result.error) return c.json({ error: result.error instanceof Error ? result.error.message : '规则 Provider 删除失败' }, 409); return result.value ? c.json({ deleted: c.req.param('id') }) : c.json({ error: '规则 Provider 不存在' }, 404); });
app.post('/rule-providers/:id/refresh', async (c) => { const backup = exportConfigBundle(); let provider; try { provider = await refreshRuleProvider(c.req.param('id')); } catch (error) { return c.json({ error: error instanceof Error ? error.message : '规则 Provider 更新失败' }, 409); } try { await reloadMihomoIfRunning(); return c.json(provider); } catch (error) { try { importConfigBundle(backup); await reloadMihomoIfRunning(); } catch {} return c.json({ error: error instanceof Error ? error.message : '规则 Provider 更新失败' }, 409); } });

app.post('/diagnostics/browser/session', (c) => {
  const session = createBrowserDiagnosticSession();
  return c.json({ id: session.id, expiresAt: session.expiresAt, url: `http://${HOST}:${PORT}/diagnostics/browser/${session.id}` });
});

app.get('/diagnostics/browser/:id', (c) => {
  const session = getBrowserDiagnosticSession(c.req.param('id'));
  if (!session) return c.text('diagnostic session not found', 404);
  return c.html(renderBrowserDiagnosticPage(session.id));
});

app.post('/diagnostics/browser/:id/report', async (c) => {
  let body: unknown = {};
  try { body = await c.req.json(); } catch { /* invalid body is normalized below */ }
  const session = recordBrowserDiagnosticEvidence(c.req.param('id'), body);
  if (!session) return c.json({ error: 'diagnostic session expired or not found' }, 404);
  return c.json(session);
});

app.get('/diagnostics/browser/:id/status', (c) => {
  const session = getBrowserDiagnosticSession(c.req.param('id'));
  if (!session) return c.json({ error: 'diagnostic session not found' }, 404);
  return c.json(session);
});

app.get('/diagnostics/ip-profile', async (c) => {
  const ip = c.req.query('ip');
  if (!ip) return c.json({ error: 'ip is required' }, 400);
  const profile = await lookupIpProfile(ip);
  if (!profile) return c.json({ error: 'ip profile unavailable' }, 404);
  return c.json(profile);
});

app.get('/proxy', (c) => {
  const rows = store.get({ ...query(c), n: 1 });
  if (!rows.length) return c.json({ error: 'no proxy available' }, 404);
  return c.json(wire(rows[0]!));
});

app.get('/proxies', (c) => {
  const filters = query(c);
  const requestedPage = Math.max(1, Math.floor(Number(c.req.query('page') ?? 1) || 1));
  const pageSize = Math.max(
    10,
    Math.min(100, Math.floor(Number(c.req.query('page_size') ?? c.req.query('n') ?? 50) || 50)),
  );
  const total = store.count(filters);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const rows = store.get({ ...filters, n: pageSize, offset: (page - 1) * pageSize });
  const summaries = store.connectivitySummaries(rows.map((row) => row.addr));
  return c.json({
    count: rows.length,
    total,
    page,
    pageSize,
    totalPages,
    proxies: rows.map((row) => ({
      ...wire(row),
      connectivity: summaries.get(row.addr) ?? null,
    })),
  });
});

const jobsPayload = () => {
  const state = jobs.snapshot();
  return { collection: state.collection, validation: state.validation };
};

app.get('/stats', (c) => {
  const jobPayload = jobsPayload();
  const phase = jobPayload.collection.running
    ? 'collecting'
    : jobPayload.validation.running
      ? 'validating'
      : 'idle';
  return c.json({
    ...store.stats(),
    running: jobPayload.collection.running || jobPayload.validation.running,
    phase,
    jobs: jobPayload,
    lastRun: jobs.snapshot().lastRun,
    lastError: jobPayload.validation.lastError ?? jobPayload.collection.lastError,
  });
});

app.get('/log', (c) => c.json({ lines: jobs.snapshot().log }));

const controlPayload = () => {
  const automation = getAutomationSettings();
  const jobState = jobs.snapshot();
  const bySource = new Map(store.stats().bySource.map((row) => [row.source, row]));
  const now = Date.now();
  return {
    automation,
    scheduler: {
      lastCollectAt: jobState.lastCollectAt,
      lastValidateAt: jobState.lastValidateAt,
      nextCollectAt: automation.enabled
        ? (jobState.lastCollectAt ?? now) + automation.collectIntervalMinutes * 60_000
        : null,
      nextValidateAt: automation.enabled
        ? (jobState.lastValidateAt ?? now) + automation.recheckIntervalMinutes * 60_000
        : null,
    },
    sources: sourceStatuses().map((source) => ({
      ...source,
      total: bySource.get(source.name)?.total ?? 0,
      live: bySource.get(source.name)?.live ?? 0,
    })),
  };
};

app.get('/control', (c) => c.json(controlPayload()));

app.patch('/control', async (c) => {
  let patch: unknown = {};
  try {
    patch = await c.req.json();
  } catch {
    // An empty patch simply returns the current settings.
  }
  updateAutomationSettings(patch);
  scheduler.reschedule();
  return c.json(controlPayload());
});

app.patch('/sources/:name', async (c) => {
  const name = c.req.param('name');
  if (!sourceExists(name)) return c.json({ error: 'source not found' }, 404);
  let body: { enabled?: unknown } = {};
  try {
    body = await c.req.json<{ enabled?: unknown }>();
  } catch {
    // The validation below returns a useful 400 for an empty body.
  }
  if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled must be boolean' }, 400);
  setSourceEnabled(name, body.enabled);
  return c.json(controlPayload());
});

app.post('/sources/:name/collect', (c) => {
  const name = c.req.param('name');
  if (!sourceExists(name)) return c.json({ error: 'source not found' }, 404);
  const task = jobs.startCollection([name], false);
  if (!task) return c.json({ error: 'this source is already collecting' }, 409);
  void task.finally(scheduler.reschedule);
  return c.json({ started: true, source: name });
});

app.post('/collect', (c) => {
  const task = jobs.startCollection(undefined, true);
  if (!task) return c.json({ error: 'all enabled sources are already collecting' }, 409);
  void task.finally(scheduler.reschedule);
  return c.json({ started: true });
});

app.get('/connectivity', (c) => c.json({ targets: [...DEFAULT_CONNECTIVITY_TARGETS, ...listCustomConnectivityTargets()] }));
app.put('/connectivity/custom', async (c) => { let body: unknown = []; try { body = (await c.req.json<{ targets?: unknown }>()).targets ?? []; } catch {} return c.json({ targets: replaceCustomConnectivityTargets(body) }); });

app.post('/connectivity/check', async (c) => {
  let input: unknown;
  try {
    input = (await c.req.json<{ targets?: unknown }>()).targets;
  } catch {
    input = undefined;
  }
  const targets = input === undefined
    ? DEFAULT_CONNECTIVITY_TARGETS
    : normalizeConnectivityTargets(input);
  if (!targets.length) return c.json({ error: 'at least one valid HTTPS target is required' }, 400);

  const results = await checkConnectivity(targets);
  return c.json({ checkedAt: Date.now(), results });
});

app.post('/proxy/:addr/connectivity', async (c) => {
  const proxy = store.find(c.req.param('addr'));
  if (!proxy || proxy.score <= 0 || proxy.checked_at === null) {
    return c.json({ error: 'proxy not found' }, 404);
  }
  if (!proxy.https) return c.json({ error: 'proxy does not support HTTPS targets' }, 409);

  let input: unknown;
  try {
    input = (await c.req.json<{ targets?: unknown }>()).targets;
  } catch {
    input = undefined;
  }
  const targets = input === undefined
    ? DEFAULT_CONNECTIVITY_TARGETS
    : normalizeConnectivityTargets(input);
  if (!targets.length) return c.json({ error: 'at least one valid HTTPS target is required' }, 400);

  const results = await checkProxyConnectivity(proxy, targets);
  const checkedAt = Date.now();
  store.recordConnectivity(proxy.addr, results, checkedAt);
  return c.json({ checkedAt, proxy: wire(proxy), results });
});

app.get('/proxy/:addr/connectivity', (c) => {
  const proxy = store.find(c.req.param('addr'));
  if (!proxy) return c.json({ error: 'proxy not found' }, 404);
  const results = store.connectivityResults(proxy.addr);
  return c.json({
    checkedAt: results.reduce((latest, result) => Math.max(latest, result.checkedAt), 0) || null,
    proxy: wire(proxy),
    results: results.map((result) => ({ ...result, via: null, error: null })),
  });
});

const currentGatewayProxy = () => {
  const routing = getGatewayRouting();
  const selectedService = serviceProfile(routing.profile);
  const routeFilters = {
    https: true,
    minScore: 1,
    country: routing.country ?? undefined,
    target: selectedService?.target.id,
  };
  const active = picker.active
    ? (store.find(picker.active.addr) ?? picker.active)
    : null;
  const current = active
    ?? store.get({ ...routeFilters, n: 1, exitIp: true })[0]
    ?? store.get({ ...routeFilters, target: undefined, n: 1, exitIp: true })[0]
    ?? store.get({ ...routeFilters, target: undefined, n: 1 })[0]
    ?? null;
  return { active, current, routeFilters, routing, selectedService };
};

app.post('/gateway/connectivity', async (c) => {
  const { current } = currentGatewayProxy();
  if (!current) return c.json({ error: 'no gateway proxy available' }, 404);

  let input: unknown;
  try {
    input = (await c.req.json<{ targets?: unknown }>()).targets;
  } catch {
    input = undefined;
  }
  const targets = input === undefined
    ? DEFAULT_CONNECTIVITY_TARGETS
    : normalizeConnectivityTargets(input);
  if (!targets.length) return c.json({ error: 'at least one valid HTTPS target is required' }, 400);

  const results = await checkProxyConnectivity(current, targets);
  const checkedAt = Date.now();
  store.recordConnectivity(current.addr, results, checkedAt);
  return c.json({ checkedAt, proxy: wire(current), results });
});

/** Local forwarding proxy: status, recent traffic, and strategy controls. */
app.get('/gateway', async (c) => {
  const { active, current, routeFilters, routing, selectedService } = currentGatewayProxy();
  const mihomoConnections = await mihomo.connections();
  return c.json({
    ...gatewayStats,
    strategy: picker.strategy,
    tolerance: picker.tolerance,
    rotateAfter: picker.rotateAfter,
    routing: {
      ...routing,
      eligible: store.count({ ...routeFilters, target: undefined }),
      verified: selectedService ? store.count(routeFilters) : null,
      learning: Boolean(selectedService && store.count(routeFilters) === 0),
    },
    profiles: gatewayProfiles(),
    active: active ? `${active.scheme}://${active.addr}` : null,
    currentProxy: current
      ? {
          upstream: `${current.scheme}://${current.addr}`,
          exitIp: current.exit_ip,
          country: current.country,
          latencyMs: current.latency_ms,
          score: current.score,
          active: active?.addr === current.addr,
        }
      : null,
    traffic: mihomoConnections.length ? mihomoConnections.map((item) => ({ at: item.start ? Date.parse(item.start) || Date.now() : Date.now(), target: item.metadata?.host ?? item.metadata?.destinationIP ?? '—', via: item.chains?.[0] ?? null, ms: 0, ok: true, source: 'mihomo', process: item.metadata?.process ?? null, rule: item.rule ?? null, upload: item.upload ?? 0, download: item.download ?? 0 })) : traffic().slice(0, 30).map((item) => ({ ...item, source: 'gateway', process: null, rule: null, upload: 0, download: 0 })),
  });
});

app.get('/gateway/connections', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') ?? 1) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(c.req.query('page_size') ?? 50) || 50));
  const search = c.req.query('search')?.trim().toLowerCase() ?? '';
  const process = c.req.query('process')?.trim().toLowerCase() ?? '';
  const all = await mihomo.connections(500);
  const filtered = all.filter((item) => {
    const target = `${item.metadata?.host ?? ''} ${item.metadata?.destinationIP ?? ''} ${item.rule ?? ''}`.toLowerCase();
    const proc = (item.metadata?.process ?? '').toLowerCase();
    return (!search || target.includes(search)) && (!process || proc.includes(process));
  });
  const total = filtered.length;
  const items = filtered.slice((page - 1) * pageSize, page * pageSize);
  return c.json({ page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), items });
});

app.get('/gateway/connections/stream', async (c) => {
  const encoder = new TextEncoder();
  let timer: NodeJS.Timeout | null = null;
  let done = false;
  const stream = new ReadableStream({
    async start(controller) {
      const write = async () => {
        if (done) return;
        const items = await mihomo.connections(200);
        if (done) return;
        try { controller.enqueue(encoder.encode(`event: connections\ndata: ${JSON.stringify({ at: Date.now(), source: mihomo.running ? 'mihomo' : 'gateway', items })}\n\n`)); } catch { done = true; }
      };
      await write();
      if (done) return;
      timer = setInterval(() => { void write(); }, 2000);
      setTimeout(() => { done = true; if (timer) clearInterval(timer); timer = null; try { controller.close(); } catch {} }, 60_000);
    },
    cancel() { done = true; if (timer) clearInterval(timer); timer = null; },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
});

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

app.patch('/gateway/routing', async (c) => {
  let patch: unknown = {};
  try {
    patch = await c.req.json();
  } catch {
    // Empty input returns the current routing policy.
  }
  const routing = updateGatewayRouting(patch);
  picker.invalidate();
  return c.json({ routing, profiles: gatewayProfiles() });
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
  const withCollection = c.req.query('collect') !== 'false';
  const tasks: Promise<void>[] = [];
  if (withCollection) {
    const collectionTask = jobs.startCollection(undefined, true);
    if (collectionTask) tasks.push(collectionTask);
  }
  const validationTask = jobs.startValidation(getAutomationSettings().validateBatch);
  if (validationTask) tasks.push(validationTask);
  if (!tasks.length) return c.json({ error: 'requested jobs are already running' }, 409);
  void Promise.all(tasks).finally(scheduler.reschedule);
  return c.json({ started: true, jobs: jobsPayload() });
});

export async function cycle(
  collectFirst = true,
  limit = getAutomationSettings().validateBatch,
  sourceNames?: string[],
) {
  await jobs.cycle(collectFirst, limit, sourceNames);
}
export function startLoop() {
  return scheduler.start();
}

export function stopLoop() {
  scheduler.stop();
}
