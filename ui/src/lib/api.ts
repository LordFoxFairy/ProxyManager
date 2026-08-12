const BASE = import.meta.env.VITE_API ?? 'http://127.0.0.1:8787';

export interface Proxy {
  url: string;
  addr: string;
  scheme: 'http' | 'socks4' | 'socks5';
  score: number;
  anonymity: string | null;
  country: string | null;
  exitIp: string | null;
  https: boolean;
  latencyMs: number | null;
  okCount: number;
  failCount: number;
  source: string | null;
  checkedAt: number | null;
  connectivity: {
    available: number;
    total: number;
    checkedAt: number;
  } | null;
}

export interface Stats {
  total: number;
  live: number;
  liveHttps: number;
  unchecked: number;
  buried: number;
  avgLatency: number | null;
  byScheme: Record<string, number>;
  byAnonymity: Record<string, number>;
  byCountry: Record<string, number>;
  bySource: { source: string; total: number; live: number }[];
  running: boolean;
  phase: 'idle' | 'collecting' | 'validating';
  jobs: {
    collection: {
      running: boolean;
      full: boolean;
      sources: string[];
      startedAt: number | null;
      lastCompletedAt: number | null;
      fullLastCompletedAt: number | null;
      lastError: string | null;
    };
    validation: {
      running: boolean;
      stage: 'idle' | 'tcp' | 'proxy' | 'geo';
      total: number;
      completed: number;
      reachable: number;
      passed: number;
      startedAt: number | null;
      lastCompletedAt: number | null;
      lastError: string | null;
    };
  };
  lastRun: number | null;
  lastError: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const getStats = () => req<Stats>('/stats');

export interface ProxyQuery {
  page?: number;
  pageSize?: number;
  scheme?: string;
  https?: boolean;
  country?: string;
  anonymity?: string;
  minScore?: number;
  target?: string;
  search?: string;
}

export const getProxies = (q: ProxyQuery) => {
  const p = new URLSearchParams({
    page: String(q.page ?? 1),
    page_size: String(q.pageSize ?? 50),
  });
  if (q.scheme) p.set('scheme', q.scheme);
  if (q.https) p.set('https', 'true');
  if (q.country) p.set('country', q.country);
  if (q.anonymity) p.set('anonymity', q.anonymity);
  if (q.minScore != null) p.set('min_score', String(q.minScore));
  if (q.target) p.set('target', q.target);
  if (q.search) p.set('search', q.search);
  return req<{
    count: number;
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    proxies: Proxy[];
  }>(`/proxies?${p}`);
};

export const getLog = () => req<{ lines: string[] }>('/log');

export type Strategy = 'url-test' | 'round-robin' | 'random';

export interface Gateway {
  running: boolean;
  port: number;
  requests: number;
  failed: number;
  strategy: Strategy;
  tolerance: number;
  rotateAfter: number;
  routing: {
    profile: string;
    country: string | null;
    eligible: number;
    verified: number | null;
    learning: boolean;
  };
  profiles: { id: string; name: string; targetId: string | null }[];
  active: string | null;
  currentProxy: {
    upstream: string;
    exitIp: string | null;
    country: string | null;
    latencyMs: number | null;
    score: number;
    active: boolean;
  } | null;
  traffic: { at: number; target: string; via: string | null; ms: number; ok: boolean }[];
}

export interface RuntimeConfig {
  mode: 'rule' | 'global' | 'direct';
  mixedPort: number;
  httpPort: number;
  socksPort: number;
  systemProxy: boolean;
  tun: boolean;
  dns: boolean;
}

export interface RuntimeStatus {
  kind: 'builtin' | 'mihomo';
  lifecycle: 'stopped' | 'running' | 'degraded' | 'error';
  version: string | null;
  controller: string | null;
  configVersion: number;
  configValid: boolean;
  systemProxy: 'on' | 'off' | 'unsupported';
  tun: 'on' | 'off' | 'unsupported';
  capabilities: { systemProxy: boolean; tun: boolean; mihomo: boolean };
  lastError: string | null;
}

export const getRuntime = () => req<{ status: RuntimeStatus; config: RuntimeConfig }>('/runtime');
export const updateRuntime = (patch: Partial<RuntimeConfig> & { kind?: 'builtin' | 'mihomo' }) =>
  req<{ status: RuntimeStatus; config: RuntimeConfig }>('/runtime', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
export const runtimeAction = (action: 'start' | 'stop' | 'restart') =>
  req<{ status: RuntimeStatus }>('/runtime/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) });

export interface AutomationSettings {
  enabled: boolean;
  autoPurgeEnabled: boolean;
  collectIntervalMinutes: number;
  recheckIntervalMinutes: number;
  validateBatch: number;
}

export interface SourceControl {
  name: string;
  url: string;
  scheme: 'http' | 'socks4' | 'socks5' | null;
  recommended: boolean;
  format?: 'lines' | 'zdaye';
  pages?: number;
  enabled: boolean;
  running: boolean;
  lastRun: number | null;
  lastCandidates: number | null;
  durationMs: number | null;
  lastError: string | null;
  total: number;
  live: number;
}

export interface ControlState {
  automation: AutomationSettings;
  scheduler: {
    lastCollectAt: number | null;
    lastValidateAt: number | null;
    nextCollectAt: number | null;
    nextValidateAt: number | null;
  };
  sources: SourceControl[];
}

export interface ConnectivityTarget {
  id: string;
  name: string;
  url: string;
}

export interface ConnectivityResult extends ConnectivityTarget {
  available: boolean;
  latencyMs: number | null;
  statusCode: number | null;
  via: string | null;
  error: 'no-proxy' | 'timeout' | 'unreachable' | null;
}

export interface BrowserEvidence {
  ipv4: string | null;
  ipv6: string | null;
  webrtcPublic: string[];
  webrtcPrivate: string[];
  webrtcMdns: boolean;
  timezone: string | null;
  language: string | null;
  languages: string[];
  userAgent: string | null;
  platform: string | null;
  screen: string | null;
  collectedAt: number;
}

export interface BrowserDiagnosticSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  state: 'pending' | 'complete' | 'expired';
  evidence: BrowserEvidence | null;
}

export const createBrowserDiagnosticSession = () =>
  req<{ id: string; expiresAt: number; url: string }>('/diagnostics/browser/session', { method: 'POST' });

export const getBrowserDiagnosticStatus = (id: string) =>
  req<BrowserDiagnosticSession>(`/diagnostics/browser/${encodeURIComponent(id)}/status`);

export interface IpProfile {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  proxy: boolean | null;
  hosting: boolean | null;
  mobile: boolean | null;
}

export const getIpProfile = (ip: string) => req<IpProfile>(`/diagnostics/ip-profile?ip=${encodeURIComponent(ip)}`);

export const getGateway = () => req<Gateway>('/gateway');

export const updateGatewayRouting = (routing: { profile?: string; country?: string | null }) =>
  req<{ routing: Gateway['routing']; profiles: Gateway['profiles'] }>('/gateway/routing', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(routing),
  });

export const getControl = () => req<ControlState>('/control');

export const updateControl = (settings: Partial<AutomationSettings>) =>
  req<ControlState>('/control', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(settings),
  });

export const updateSource = (name: string, enabled: boolean) =>
  req<ControlState>(`/sources/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

export const collectSource = (name: string) =>
  req<{ started: boolean; source: string }>(`/sources/${encodeURIComponent(name)}/collect`, {
    method: 'POST',
  });

export const collectAllSources = () =>
  req<{ started: boolean }>('/collect', { method: 'POST' });

export const getConnectivityTargets = () =>
  req<{ targets: ConnectivityTarget[] }>('/connectivity');

export const checkConnectivity = (targets: ConnectivityTarget[]) =>
  req<{ checkedAt: number; results: ConnectivityResult[] }>('/connectivity/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ targets }),
  });

export const checkProxyConnectivity = (addr: string, targets: ConnectivityTarget[]) =>
  req<{ checkedAt: number; proxy: Proxy; results: ConnectivityResult[] }>(
    `/proxy/${encodeURIComponent(addr)}/connectivity`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets }),
    },
  );

export const checkGatewayConnectivity = (targets: ConnectivityTarget[]) =>
  req<{ checkedAt: number; proxy: Proxy; results: ConnectivityResult[] }>(
    '/gateway/connectivity',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targets }),
    },
  );

export const getProxyConnectivity = (addr: string) =>
  req<{
    checkedAt: number | null;
    proxy: Proxy;
    results: (ConnectivityResult & { checkedAt: number })[];
  }>(`/proxy/${encodeURIComponent(addr)}/connectivity`);

export const setStrategy = (s: Strategy) =>
  req<unknown>(`/gateway/strategy?strategy=${s}`, { method: 'POST' });

export const refresh = (collect = true) =>
  req<{ started: boolean }>(`/refresh?collect=${collect}`, { method: 'POST' });

export const removeProxy = (addr: string) =>
  req<{ deleted: string }>(`/proxy/${encodeURIComponent(addr)}`, { method: 'DELETE' });
