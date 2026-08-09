const BASE = import.meta.env.VITE_API ?? 'http://127.0.0.1:8787';

export interface Proxy {
  url: string;
  addr: string;
  scheme: 'http' | 'socks4' | 'socks5';
  score: number;
  anonymity: string | null;
  country: string | null;
  https: boolean;
  latencyMs: number | null;
  okCount: number;
  failCount: number;
  source: string | null;
  checkedAt: number | null;
}

export interface Stats {
  total: number;
  live: number;
  liveHttps: number;
  unchecked: number;
  avgLatency: number | null;
  byScheme: Record<string, number>;
  byAnonymity: Record<string, number>;
  byCountry: Record<string, number>;
  bySource: { source: string; total: number; live: number }[];
  running: boolean;
  phase: 'idle' | 'collecting' | 'validating';
  lastRun: number | null;
  lastError: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const getStats = () => req<Stats>('/stats');

export const getProxies = (q: { n?: number; scheme?: string; https?: boolean }) => {
  const p = new URLSearchParams({ n: String(q.n ?? 100) });
  if (q.scheme) p.set('scheme', q.scheme);
  if (q.https) p.set('https', 'true');
  return req<{ count: number; proxies: Proxy[] }>(`/proxies?${p}`);
};

export const getLog = () => req<{ lines: string[] }>('/log');

export const refresh = (collect = true) =>
  req<{ started: boolean }>(`/refresh?collect=${collect}`, { method: 'POST' });

export const removeProxy = (addr: string) =>
  req<{ deleted: string }>(`/proxy/${encodeURIComponent(addr)}`, { method: 'DELETE' });
