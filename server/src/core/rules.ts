import { getSetting, setSetting } from './store.js';

export type RuleKind = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'IP-CIDR' | 'PROCESS-NAME' | 'MATCH';
export interface RoutingRule { id: string; kind: RuleKind; value: string; target: string; enabled: boolean; }
const KEY = 'routing.rules';
const defaults: RoutingRule[] = [];
function read(): RoutingRule[] { try { const raw = getSetting(KEY); return raw ? JSON.parse(raw) as RoutingRule[] : defaults; } catch { return defaults; } }
export function listRules() { return read(); }
export function upsertRule(input: unknown): RoutingRule { const row = input && typeof input === 'object' ? input as Record<string, unknown> : {}; const current = read(); const id = String(row.id ?? `rule-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64); const old = current.find((item) => item.id === id); const kinds: RuleKind[] = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'PROCESS-NAME', 'MATCH']; const kind = kinds.includes(row.kind as RuleKind) ? row.kind as RuleKind : old?.kind ?? 'DOMAIN-SUFFIX'; const rule: RoutingRule = { id, kind, value: String(row.value ?? old?.value ?? '').slice(0, 255), target: String(row.target ?? old?.target ?? 'PROXY').slice(0, 80), enabled: typeof row.enabled === 'boolean' ? row.enabled : old?.enabled ?? true }; setSetting(KEY, JSON.stringify([...current.filter((item) => item.id !== id), rule])); return rule; }
export function removeRule(id: string) { const current = read(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; setSetting(KEY, JSON.stringify(next)); return true; }
