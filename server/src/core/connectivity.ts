import https from 'node:https';
import net from 'node:net';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { CHECK_TIMEOUT } from '../config.js';
import { SERVICE_PROFILES } from './services.js';
import { get, type Proxy } from './store.js';
import { getSetting, setSetting } from './store.js';

const MAX_TARGETS = 14;
const MAX_ATTEMPTS = 3;

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

export const DEFAULT_CONNECTIVITY_TARGETS: ConnectivityTarget[] = [
  ...SERVICE_PROFILES.map((profile) => profile.target),
  { id: 'cloudflare', name: 'Cloudflare', url: 'https://www.cloudflare.com/cdn-cgi/trace' },
  { id: 'wikipedia', name: 'Wikipedia', url: 'https://www.wikipedia.org/' },
];
const CUSTOM_KEY = 'connectivity.custom-targets';
export function listCustomConnectivityTargets(): ConnectivityTarget[] { try { const value = JSON.parse(getSetting(CUSTOM_KEY) ?? '[]'); return normalizeConnectivityTargets(value); } catch { return []; } }
export function replaceCustomConnectivityTargets(value: unknown): ConnectivityTarget[] { const targets = normalizeConnectivityTargets(value); setSetting(CUSTOM_KEY, JSON.stringify(targets.slice(0, 6))); return targets.slice(0, 6); }

/** Keep the loopback API from becoming an arbitrary local-network request relay. */
export function normalizeConnectivityTargets(input: unknown): ConnectivityTarget[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const targets: ConnectivityTarget[] = [];

  for (const item of input.slice(0, MAX_TARGETS)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? '').trim().slice(0, 48);
    const name = String(row.name ?? '').trim().slice(0, 32);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !name || seen.has(id)) continue;

    try {
      const url = new URL(String(row.url ?? '').slice(0, 2048));
      const hostname = url.hostname.toLowerCase();
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        (url.port && url.port !== '443') ||
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        !hostname.includes('.') ||
        net.isIP(hostname)
      ) {
        continue;
      }
      url.hash = '';
      seen.add(id);
      targets.push({ id, name, url: url.toString() });
    } catch {
      // Invalid rows are omitted; the route rejects an entirely empty request.
    }
  }

  return targets;
}

const agentFor = (proxy: Proxy) =>
  proxy.scheme === 'http'
    ? new HttpsProxyAgent(`http://${proxy.addr}`)
    : new SocksProxyAgent(`${proxy.scheme}://${proxy.addr}`);

function requestTarget(
  target: ConnectivityTarget,
  proxy: Proxy,
): Promise<{ statusCode: number | null; latencyMs: number | null; error: 'timeout' | 'unreachable' | null }> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const agent = agentFor(proxy);
    let settled = false;
    let req: ReturnType<typeof https.get>;

    const finish = (
      statusCode: number | null,
      error: 'timeout' | 'unreachable' | null,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      req?.destroy();
      agent.destroy();
      resolve({
        statusCode,
        latencyMs: statusCode === null ? null : Date.now() - startedAt,
        error,
      });
    };

    const deadline = setTimeout(() => finish(null, 'timeout'), CHECK_TIMEOUT);
    req = https.get(
      target.url,
      {
        agent: agent as unknown as https.Agent,
        headers: {
          accept: '*/*',
          'user-agent': 'ProxyManager/0.1 connectivity-check',
        },
      },
      (res) => {
        const status = res.statusCode ?? null;
        res.resume();
        finish(status, status === null ? 'unreachable' : null);
      },
    );
    req.on('error', () => finish(null, 'unreachable'));
  });
}

async function checkTarget(target: ConnectivityTarget, proxies: Proxy[]): Promise<ConnectivityResult> {
  if (!proxies.length) {
    return {
      ...target,
      available: false,
      latencyMs: null,
      statusCode: null,
      via: null,
      error: 'no-proxy',
    };
  }

  let lastError: 'timeout' | 'unreachable' = 'unreachable';
  let lastVia: string | null = null;
  for (const proxy of proxies.slice(0, MAX_ATTEMPTS)) {
    lastVia = `${proxy.scheme}://${proxy.addr}`;
    const result = await requestTarget(target, proxy);
    if (result.statusCode !== null) {
      return {
        ...target,
        available: true,
        latencyMs: result.latencyMs,
        statusCode: result.statusCode,
        via: lastVia,
        error: null,
      };
    }
    lastError = result.error ?? 'unreachable';
  }

  return {
    ...target,
    available: false,
    latencyMs: null,
    statusCode: null,
    via: lastVia,
    error: lastError,
  };
}

export async function checkConnectivity(targets: ConnectivityTarget[]): Promise<ConnectivityResult[]> {
  const proxies = get({ n: 8, https: true, minScore: 1 });
  return Promise.all(targets.map((target) => checkTarget(target, proxies)));
}

export async function checkProxyConnectivity(
  proxy: Proxy,
  targets: ConnectivityTarget[],
): Promise<ConnectivityResult[]> {
  return Promise.all(targets.map((target) => checkTarget(target, [proxy])));
}
