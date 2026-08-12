import { getSetting, setSetting } from './store.js';

export type RuntimeKind = 'builtin' | 'mihomo';
export type RuntimeLifecycle = 'stopped' | 'running' | 'degraded' | 'error';

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
  kind: RuntimeKind;
  lifecycle: RuntimeLifecycle;
  version: string | null;
  controller: string | null;
  configVersion: number;
  configValid: boolean;
  systemProxy: 'on' | 'off' | 'unsupported';
  tun: 'on' | 'off' | 'unsupported';
  capabilities: { systemProxy: boolean; tun: boolean; mihomo: boolean };
  lastError: string | null;
}

const CONFIG_KEY = 'runtime.config';
const VERSION_KEY = 'runtime.config.version';
const KIND_KEY = 'runtime.kind';

const defaults: RuntimeConfig = {
  mode: 'rule', mixedPort: 7899, httpPort: 7899, socksPort: 7898,
  systemProxy: false, tun: false, dns: false,
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
  };
  setSetting(CONFIG_KEY, JSON.stringify(next));
  setSetting(VERSION_KEY, String(readVersion() + 1));
  return next;
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
    lifecycle: kind === 'mihomo' ? (mihomoAvailable ? 'stopped' : 'degraded') : builtinRunning ? 'running' : 'stopped',
    version: kind === 'mihomo' && mihomoAvailable ? 'sidecar-configured' : kind === 'builtin' ? 'builtin-gateway' : null,
    controller: kind === 'mihomo' ? getSetting('runtime.controller') : null,
    configVersion: readVersion(),
    configValid: config.mixedPort !== config.socksPort && config.mixedPort !== config.httpPort,
    systemProxy: kind === 'mihomo' && !mihomoAvailable ? 'unsupported' : config.systemProxy ? 'on' : 'off',
    tun: kind === 'mihomo' && !mihomoAvailable ? 'unsupported' : config.tun ? 'on' : 'off',
    capabilities: { systemProxy: kind === 'mihomo' && mihomoAvailable, tun: kind === 'mihomo' && mihomoAvailable, mihomo: mihomoAvailable },
    lastError: kind === 'mihomo' && !mihomoAvailable ? '未配置 PM_MIHOMO_BIN' : null,
  };
}

export function setRuntimeKind(kind: unknown): RuntimeKind {
  const next: RuntimeKind = kind === 'mihomo' ? 'mihomo' : 'builtin';
  setSetting(KIND_KEY, next);
  return next;
}
