import { getSetting, setSetting } from './store.js';
import { mihomo } from './mihomo.js';
import { createConnection } from 'node:net';
import { existsSync } from 'node:fs';
import { createSocket } from 'node:dgram';

export type RuntimeKind = 'builtin' | 'mihomo';
export type RuntimeLifecycle = 'stopped' | 'running' | 'degraded' | 'error';
export type RuntimeFeatureState = 'active' | 'configured' | 'inactive' | 'unsupported' | 'permission-required' | 'failed' | 'unknown';

export interface RuntimeConfig {
  mode: 'rule' | 'global' | 'direct';
  mixedPort: number;
  httpPort: number;
  socksPort: number;
  systemProxy: boolean;
  tun: boolean;
  dns: boolean;
  dnsListen: string;
  dnsMode: 'fake-ip' | 'redir-host';
  dnsNameservers: string[];
  tunStack: 'system' | 'gvisor' | 'mixed';
  tunAutoRoute: boolean;
  tunAutoDetectInterface: boolean;
  tunDnsHijack: string[];
}

export interface RuntimeStatus {
  kind: RuntimeKind;
  lifecycle: RuntimeLifecycle;
  version: string | null;
  controller: string | null;
  configVersion: number;
  configValid: boolean;
  systemProxy: 'on' | 'off' | 'unsupported';
  tun: 'on' | 'off' | 'unsupported';
  dns: 'on' | 'off' | 'unsupported';
  capabilities: { systemProxy: boolean; tun: boolean; dns: boolean; mihomo: boolean };
  features: { controller: RuntimeFeatureState; tun: RuntimeFeatureState; dns: RuntimeFeatureState };
  platform: { os: string; tunDevice: RuntimeFeatureState; dnsPermission: RuntimeFeatureState };
  logs: string[];
  lastError: string | null;
}

const CONFIG_KEY = 'runtime.config';
const VERSION_KEY = 'runtime.config.version';
const KIND_KEY = 'runtime.kind';
const PREVIOUS_CONFIG_KEY = 'runtime.config.previous';

const defaults: RuntimeConfig = {
  mode: 'rule', mixedPort: 7899, httpPort: 7897, socksPort: 7898,
  systemProxy: false, tun: false, dns: false, dnsListen: '127.0.0.1:1053', dnsMode: 'fake-ip', dnsNameservers: ['https://dns.alidns.com/dns-query', 'https://cloudflare-dns.com/dns-query'], tunStack: 'system', tunAutoRoute: true, tunAutoDetectInterface: true, tunDnsHijack: ['any:53', 'tcp://any:53'],
};

const readConfig = (): RuntimeConfig => {
  try {
    const raw = getSetting(CONFIG_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;
    return {
      ...defaults,
      ...parsed,
      mode: parsed.mode === 'global' || parsed.mode === 'direct' ? parsed.mode : 'rule',
      dnsMode: parsed.dnsMode === 'redir-host' ? 'redir-host' : 'fake-ip',
      dnsNameservers: Array.isArray(parsed.dnsNameservers) ? parsed.dnsNameservers.filter((item): item is string => typeof item === 'string').slice(0, 8) : defaults.dnsNameservers,
      tunStack: parsed.tunStack === 'gvisor' || parsed.tunStack === 'mixed' ? parsed.tunStack : 'system',
      tunDnsHijack: Array.isArray(parsed.tunDnsHijack) ? parsed.tunDnsHijack.filter((item): item is string => typeof item === 'string').slice(0, 8) : defaults.tunDnsHijack,
    };
  } catch { return defaults; }
};

const readKind = (): RuntimeKind => getSetting(KIND_KEY) === 'mihomo' ? 'mihomo' : 'builtin';

export function getRuntimeConfig(): RuntimeConfig { return readConfig(); }

export function updateRuntimeConfig(input: unknown): RuntimeConfig {
  if (!input || typeof input !== 'object') return readConfig();
  const patch = input as Record<string, unknown>;
  const current = readConfig();
  const next: RuntimeConfig = {
    ...current,
    mode: patch.mode === 'global' || patch.mode === 'direct' || patch.mode === 'rule' ? patch.mode : current.mode,
    mixedPort: integer(patch.mixedPort, current.mixedPort, 1024, 65535),
    httpPort: integer(patch.httpPort, current.httpPort, 1024, 65535),
    socksPort: integer(patch.socksPort, current.socksPort, 1024, 65535),
    systemProxy: typeof patch.systemProxy === 'boolean' ? patch.systemProxy : current.systemProxy,
    tun: typeof patch.tun === 'boolean' ? patch.tun : current.tun,
    dns: typeof patch.dns === 'boolean' ? patch.dns : current.dns,
    dnsListen: typeof patch.dnsListen === 'string' && patch.dnsListen.trim() ? patch.dnsListen.trim().slice(0, 64) : current.dnsListen,
    dnsMode: patch.dnsMode === 'redir-host' ? 'redir-host' : patch.dnsMode === 'fake-ip' ? 'fake-ip' : current.dnsMode,
    dnsNameservers: Array.isArray(patch.dnsNameservers) ? patch.dnsNameservers.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 8) : current.dnsNameservers,
    tunStack: patch.tunStack === 'gvisor' || patch.tunStack === 'mixed' || patch.tunStack === 'system' ? patch.tunStack : current.tunStack,
    tunAutoRoute: typeof patch.tunAutoRoute === 'boolean' ? patch.tunAutoRoute : current.tunAutoRoute,
    tunAutoDetectInterface: typeof patch.tunAutoDetectInterface === 'boolean' ? patch.tunAutoDetectInterface : current.tunAutoDetectInterface,
    tunDnsHijack: Array.isArray(patch.tunDnsHijack) ? patch.tunDnsHijack.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()).slice(0, 8) : current.tunDnsHijack,
  };
  setSetting(PREVIOUS_CONFIG_KEY, JSON.stringify(current));
  setSetting(CONFIG_KEY, JSON.stringify(next));
  setSetting(VERSION_KEY, String(readVersion() + 1));
  return next;
}

export function rollbackRuntimeConfig(): RuntimeConfig {
  const raw = getSetting(PREVIOUS_CONFIG_KEY);
  if (!raw) return readConfig();
  try {
    const current = readConfig();
    const previous = JSON.parse(raw) as RuntimeConfig;
    setSetting(PREVIOUS_CONFIG_KEY, JSON.stringify(current));
    setSetting(CONFIG_KEY, JSON.stringify(previous));
    setSetting(VERSION_KEY, String(readVersion() + 1));
    return previous;
  } catch { return readConfig(); }
}

function integer(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
}

function readVersion() { return Number(getSetting(VERSION_KEY) ?? 0) || 0; }

export function getRuntimeStatus(): RuntimeStatus {
  const config = readConfig();
  const kind = readKind();
  const builtinRunning = true;
  const mihomoAvailable = Boolean(process.env.PM_MIHOMO_BIN);
  return {
    kind,
    lifecycle: kind === 'mihomo' ? (mihomo.running ? 'running' : mihomo.recovering ? 'error' : mihomo.error ? 'error' : mihomoAvailable ? 'stopped' : 'degraded') : builtinRunning ? 'running' : 'stopped',
    version: kind === 'mihomo' && mihomoAvailable ? 'sidecar-configured' : kind === 'builtin' ? 'builtin-gateway' : null,
    controller: kind === 'mihomo' ? (process.env.PM_MIHOMO_CONTROLLER ?? getSetting('runtime.controller')) : null,
    configVersion: readVersion(),
    configValid: config.mixedPort !== config.socksPort && config.mixedPort !== config.httpPort,
    systemProxy: kind === 'mihomo' && !mihomoAvailable ? 'unsupported' : config.systemProxy ? 'on' : 'off',
    tun: kind === 'mihomo' && mihomoAvailable ? (config.tun ? 'on' : 'off') : 'unsupported',
    dns: kind === 'mihomo' && mihomoAvailable ? (config.dns ? 'on' : 'off') : 'unsupported',
    capabilities: { systemProxy: kind === 'mihomo' && mihomoAvailable, tun: kind === 'mihomo' && mihomoAvailable, dns: kind === 'mihomo' && mihomoAvailable, mihomo: mihomoAvailable },
    features: {
      controller: kind === 'mihomo' && mihomoAvailable ? (mihomo.running ? 'unknown' : 'inactive') : 'unsupported',
      tun: kind === 'mihomo' && mihomoAvailable ? (config.tun ? 'configured' : 'inactive') : 'unsupported',
      dns: kind === 'mihomo' && mihomoAvailable ? (config.dns ? 'configured' : 'inactive') : 'unsupported',
    },
    platform: { os: process.platform, tunDevice: process.platform === 'linux' ? (requireTunDevice() ? 'configured' : 'permission-required') : process.platform === 'win32' || process.platform === 'darwin' ? 'permission-required' : 'unsupported', dnsPermission: 'unknown' },
    logs: mihomo.logs,
    lastError: mihomo.error ?? (kind === 'mihomo' && !mihomoAvailable ? '未配置 PM_MIHOMO_BIN' : null),
  };
}

function requireTunDevice() {
  try { return existsSync('/dev/net/tun'); } catch { return false; }
}

function tcpProbe(address: string, timeoutMs = 700): Promise<boolean> {
  const match = address.match(/^\[?([^\]]+)\]?:([0-9]+)$/);
  if (!match) return Promise.resolve(false);
  const host = (match[1] === '0.0.0.0' || match[1] === '::' ? '127.0.0.1' : match[1])!;
  const port = Number(match[2]);
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

export function dnsResponseMatches(message: Buffer, id: number): boolean {
  return message.length >= 12
    && message[0] === ((id >> 8) & 255)
    && message[1] === (id & 255)
    && (message[2]! & 0x80) !== 0
    && (message[3]! & 0x0f) === 0;
}

function dnsProbe(address: string, timeoutMs = 1000): Promise<boolean> {
  const match = address.match(/^\[?([^\]]+)\]?:([0-9]+)$/);
  if (!match) return Promise.resolve(false);
  const host = (match[1] === '0.0.0.0' || match[1] === '::' ? '127.0.0.1' : match[1])!;
  const port = Number(match[2]);
  const socket = createSocket(host.includes(':') ? 'udp6' : 'udp4');
  const id = Math.floor(Math.random() * 0xffff);
  const name = Buffer.from([7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0]);
  const packet = Buffer.concat([Buffer.from([(id >> 8) & 255, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0]), name, Buffer.from([0, 1, 0, 1])]);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean) => { if (settled) return; settled = true; clearTimeout(timer); socket.close(); resolve(value); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.on('message', (message) => finish(dnsResponseMatches(message, id)));
    socket.on('error', () => finish(false));
    socket.send(packet, port, host, (error) => { if (error) finish(false); });
  });
}

export async function probeRuntimeStatus(): Promise<RuntimeStatus> {
  const base = getRuntimeStatus();
  const config = getRuntimeConfig();
  if (base.kind !== 'mihomo' || !base.capabilities.mihomo) return base;
  if (!mihomo.running) return { ...base, features: { ...base.features, controller: 'inactive', tun: base.tun === 'on' ? 'failed' : 'inactive', dns: base.dns === 'on' ? 'failed' : 'inactive' }, platform: { ...base.platform, dnsPermission: config.dns ? 'unknown' : 'inactive' }, lastError: base.lastError ?? 'Mihomo 未运行' };
  const controller = base.controller ?? process.env.PM_MIHOMO_CONTROLLER ?? '127.0.0.1:9090';
  let controllerOk = false;
  try {
    const headers: Record<string, string> = {};
    if (process.env.PM_MIHOMO_SECRET) headers.authorization = `Bearer ${process.env.PM_MIHOMO_SECRET}`;
    const response = await fetch(`http://${controller}/version`, { signal: AbortSignal.timeout(1000), headers });
    controllerOk = response.ok;
  } catch { /* controller is not reachable */ }
  const dnsOk = config.dns ? await dnsProbe(config.dnsListen) : false;
  return {
    ...base,
    features: {
      controller: controllerOk ? 'active' : 'failed',
      dns: !config.dns ? 'inactive' : dnsOk ? 'active' : 'failed',
      // A running controller with an enabled TUN config proves the daemon accepted it,
      // but only a platform helper can prove a system route was installed.
      tun: !config.tun ? 'inactive' : controllerOk ? 'configured' : 'failed',
    },
    platform: { ...base.platform, dnsPermission: !config.dns ? 'inactive' : dnsOk ? 'active' : 'failed' },
    logs: mihomo.logs,
    lastError: controllerOk ? base.lastError : 'Mihomo controller 不可达',
  };
}

export async function applyRuntimeAction(action: unknown): Promise<RuntimeStatus> {
  const kind = readKind();
  if (kind !== 'mihomo') throw new Error('当前运行时不是 Mihomo');
  if (action === 'start' || action === 'restart') {
    if (action === 'restart') await mihomo.stop();
    await mihomo.start(readConfig());
  } else if (action === 'stop') {
    await mihomo.stop();
  } else {
    throw new Error('不支持的 Runtime 操作');
  }
  return getRuntimeStatus();
}

export function setRuntimeKind(kind: unknown): RuntimeKind {
  const next: RuntimeKind = kind === 'mihomo' ? 'mihomo' : 'builtin';
  setSetting(KIND_KEY, next);
  return next;
}
