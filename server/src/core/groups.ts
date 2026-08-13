import { getSetting, setSetting } from './store.js';

export type GroupKind = 'select' | 'url-test' | 'fallback' | 'load-balance';
export interface ProxyGroup {
  id: string;
  name: string;
  kind: GroupKind;
  members: string[];
  url: string;
  interval: number;
  tolerance: number;
  enabled: boolean;
}

const KEY = 'proxy.groups';
const defaults: ProxyGroup[] = [
  { id: 'proxy', name: 'PROXY', kind: 'select', members: ['DIRECT'], url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 300, enabled: true },
  { id: 'auto', name: '自动选择', kind: 'url-test', members: ['PROXY'], url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 300, enabled: true },
  { id: 'fallback', name: '故障转移', kind: 'fallback', members: ['PROXY', 'DIRECT'], url: 'https://www.gstatic.com/generate_204', interval: 300, tolerance: 300, enabled: true },
];

function read(): ProxyGroup[] {
  try { const raw = getSetting(KEY); return raw ? JSON.parse(raw) as ProxyGroup[] : defaults; } catch { return defaults; }
}
function write(groups: ProxyGroup[]) { setSetting(KEY, JSON.stringify(groups)); }
export function listGroups() { return read(); }
function normalizeGroup(input: unknown, current: ProxyGroup[]): ProxyGroup {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const id = String(row.id ?? `group-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  const old = current.find((item) => item.id === id);
  const kind: GroupKind = row.kind === 'url-test' || row.kind === 'fallback' || row.kind === 'load-balance' ? row.kind : 'select';
  return { id, name: String(row.name ?? old?.name ?? id).slice(0, 80), kind, members: Array.isArray(row.members) ? row.members.map(String).slice(0, 500) : old?.members ?? ['DIRECT'], url: typeof row.url === 'string' ? row.url : old?.url ?? defaults[0]!.url, interval: integer(row.interval, old?.interval ?? 300, 30, 86400), tolerance: integer(row.tolerance, old?.tolerance ?? 300, 0, 10000), enabled: typeof row.enabled === 'boolean' ? row.enabled : old?.enabled ?? true };
}
export function replaceGroups(value: unknown[]): ProxyGroup[] { const current = read(); const next = value.map((item) => normalizeGroup(item, current)); write(next); return next; }
export function upsertGroup(input: unknown): ProxyGroup {
  const current = read(); const group = normalizeGroup(input, current);
  write([...current.filter((item) => item.id !== group.id), group]); return group;
}
export function removeGroup(id: string) { if (id === 'proxy') return false; const current = read(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; write(next); return true; }
function integer(value: unknown, fallback: number, min: number, max: number) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback; }
