import { homedir } from 'node:os';
import { join } from 'node:path';

const env = (k: string, d: string) => process.env[k] ?? d;
const num = (k: string, d: number) => Number(process.env[k] ?? d);

export const DB_PATH = env('PM_DB', join(homedir(), '.proxymanager', 'pool.db'));

/**
 * Free proxy lists. Both `scheme://host:port` and bare `host:port` appear, so
 * `scheme` is the fallback when a line carries none.
 */
export const SOURCES = [
  { name: 'proxifly', url: 'https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/all/data.txt', scheme: null },
  { name: 'speedx-http', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt', scheme: 'http' },
  { name: 'speedx-socks5', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt', scheme: 'socks5' },
  { name: 'speedx-socks4', url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt', scheme: 'socks4' },
  { name: 'monosans-http', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt', scheme: 'http' },
  { name: 'monosans-socks5', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt', scheme: 'socks5' },
  { name: 'monosans-socks4', url: 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt', scheme: 'socks4' },
] as const;

/**
 * Echo endpoints, best first. Every one of these has been observed failing
 * (httpbin.org 503s for hours, httpbingo.org started returning 402), so the
 * validator probes them on startup and uses the first that answers rather than
 * trusting any single service.
 *
 * `headers: true` means the response also echoes our request headers, which is
 * what anonymity classification needs. IP-only endpoints still prove
 * connectivity, so they are kept as a last resort.
 */
export const ECHO_ENDPOINTS = [
  { url: 'http://ifconfig.me/all.json', ipField: 'ip_addr', headers: true },
  { url: 'http://httpbingo.org/get', ipField: 'origin', headers: true },
  { url: 'http://httpbin.org/get', ipField: 'origin', headers: true },
  { url: 'http://api.ipify.org?format=json', ipField: 'ip', headers: false },
  { url: 'http://ip-api.com/json/?fields=query', ipField: 'query', headers: false },
] as const;

/** Probed separately: many SOCKS proxies relay plain HTTP but fail CONNECT. */
export const HTTPS_CHECK_URL = env('PM_HTTPS_CHECK_URL', 'https://api.ipify.org');

/** Geo lookup for the exit IP. Free, no key, batches up to 100 per call. */
export const GEO_BATCH_URL = 'http://ip-api.com/batch?fields=status,countryCode,query';

/**
 * Doubles as a quality filter -- a proxy slower than this is not worth keeping,
 * and most failures are connection errors that never approach the limit.
 */
export const CHECK_TIMEOUT = num('PM_TIMEOUT', 8000);
export const CONCURRENCY = num('PM_CONCURRENCY', 150);

/**
 * Asymmetric on purpose. A proxy that starts failing is almost always dead, so
 * failure costs more than success earns. One that has never passed a check is
 * dropped on its first failure: at a ~25% hit rate the other 75% would
 * otherwise pile up and consume check slots forever.
 * Consumer reports outweigh checks -- passing a validator is not proof that
 * real traffic works.
 */
export const SCORE = {
  init: 50,
  max: 100,
  ok: 10,
  fail: -30,
  failUnproven: -50,
  reportOk: 15,
  reportFail: -40,
} as const;

export const COLLECT_INTERVAL = num('PM_COLLECT_INTERVAL', 30 * 60_000);
export const RECHECK_INTERVAL = num('PM_RECHECK_INTERVAL', 3 * 60_000);
export const VALIDATE_BATCH = num('PM_VALIDATE_BATCH', 1500);

export const HOST = env('PM_HOST', '127.0.0.1');
export const PORT = num('PM_PORT', 8787);

/**
 * Local forwarding proxy. Loopback only by design -- binding this to 0.0.0.0
 * would publish an open proxy to the whole network.
 *
 * Deliberately not 7890: that is Clash/mihomo's default and collides on any
 * machine already running one.
 */
export const GATEWAY_PORT = num('PM_GATEWAY_PORT', 7899);

