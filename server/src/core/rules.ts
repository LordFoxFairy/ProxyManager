import net from 'node:net';
import { getSetting, listSettingKeys, removeSetting, setSetting } from './store.js';

export type RuleKind = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'IP-CIDR' | 'IP-CIDR6' | 'PROCESS-NAME' | 'MATCH';
export interface RoutingRule { id: string; kind: RuleKind; value: string; target: string; enabled: boolean; }
export interface RuleProvider { id: string; name: string; url: string; behavior: 'domain' | 'classical' | 'ipcidr'; interval: number; enabled: boolean; updatedAt: number | null; lastError: string | null; }
export type RuleProviderSnapshots = Record<string, string>;
const KEY = 'routing.rules';
const PROVIDER_KEY = 'routing.rule-providers';
const defaults: RoutingRule[] = [];
function read(): RoutingRule[] { try { const raw = getSetting(KEY); return raw ? JSON.parse(raw) as RoutingRule[] : defaults; } catch { return defaults; } }
export function listRules() { return read(); }
export interface RuleMatchResult { matched: boolean; rule: RoutingRule | null; target: string | null; index: number | null; }
function ipv4(value: string): number | null { if (net.isIP(value) !== 4) return null; return value.split('.').reduce((sum, part) => (sum * 256) + Number(part), 0) >>> 0; }
function ipv6(value: string): bigint | null {
  if (net.isIP(value) !== 6) return null;
  const [address] = value.split('%'); const parts = address!.split('::');
  const left = parts[0] ? parts[0].split(':').filter(Boolean) : []; const right = parts[1] ? parts[1].split(':').filter(Boolean) : [];
  if (parts.length > 2) return null;
  const words = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  if (words.length !== 8) return null;
  try { return words.reduce((result, word) => (result << 16n) | BigInt(parseInt(word, 16)), 0n); } catch { return null; }
}
function cidrMatches(value: string, pattern: string): boolean {
  const [network, prefixText] = pattern.split('/'); const candidate = ipv4(value); const base = ipv4(network ?? ''); const prefix = Number(prefixText ?? 32);
  if (candidate !== null && base !== null && Number.isInteger(prefix) && prefix >= 0 && prefix <= 32) { const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0; return (candidate & mask) === (base & mask); }
  const v6 = ipv6(value); const n6 = ipv6(network ?? ''); const prefix6 = Number(prefixText ?? 128);
  if (v6 === null || n6 === null || !Number.isInteger(prefix6) || prefix6 < 0 || prefix6 > 128) return false;
  const mask6 = prefix6 === 0 ? 0n : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix6)) - 1n);
  return (v6 & mask6) === (n6 & mask6);
}
function matches(rule: RoutingRule, input: string, kind: 'domain' | 'ip' | 'process'): boolean {
  const value = input.trim(); const expected = rule.value.trim();
  if (!rule.enabled || (kind === 'domain' && !['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'MATCH'].includes(rule.kind)) || (kind === 'ip' && !['IP-CIDR', 'IP-CIDR6', 'MATCH'].includes(rule.kind)) || (kind === 'process' && !['PROCESS-NAME', 'MATCH'].includes(rule.kind))) return false;
  if (rule.kind === 'MATCH') return true;
  if (rule.kind === 'DOMAIN') return value.toLowerCase() === expected.toLowerCase();
  if (rule.kind === 'DOMAIN-SUFFIX') { const v = value.toLowerCase().replace(/\.$/, ''); const e = expected.toLowerCase().replace(/^\./, '').replace(/\.$/, ''); return v === e || v.endsWith(`.${e}`); }
  if (rule.kind === 'DOMAIN-KEYWORD') return value.toLowerCase().includes(expected.toLowerCase());
  if (rule.kind === 'IP-CIDR' || rule.kind === 'IP-CIDR6') return cidrMatches(value, expected);
  if (rule.kind === 'PROCESS-NAME') return value.toLowerCase() === expected.toLowerCase();
  return false;
}
export function testRuleMatch(input: unknown): RuleMatchResult {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const kind = row.kind === 'ip' || row.kind === 'process' ? row.kind : 'domain';
  const value = typeof row.value === 'string' ? row.value.slice(0, 512) : '';
  if (!value.trim()) return { matched: false, rule: null, target: null, index: null };
  const rules = read(); const index = rules.findIndex((rule) => matches(rule, value, kind)); const rule = index >= 0 ? rules[index]! : null;
  return { matched: Boolean(rule), rule, target: rule?.target ?? 'PROXY', index: index >= 0 ? index : null };
}
function normalizeRule(input: unknown, current: RoutingRule[]): RoutingRule { const row = input && typeof input === 'object' ? input as Record<string, unknown> : {}; const id = String(row.id ?? `rule-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64); const old = current.find((item) => item.id === id); const kinds: RuleKind[] = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'IP-CIDR6', 'PROCESS-NAME', 'MATCH']; const kind = kinds.includes(row.kind as RuleKind) ? row.kind as RuleKind : old?.kind ?? 'DOMAIN-SUFFIX'; return { id, kind, value: String(row.value ?? old?.value ?? '').slice(0, 255), target: String(row.target ?? old?.target ?? 'PROXY').slice(0, 80), enabled: typeof row.enabled === 'boolean' ? row.enabled : old?.enabled ?? true }; }
export function replaceRules(value: unknown[]): RoutingRule[] { const current = read(); const next = value.map((item) => normalizeRule(item, current)); setSetting(KEY, JSON.stringify(next)); return next; }
export function upsertRule(input: unknown): RoutingRule { const current = read(); const rule = normalizeRule(input, current); setSetting(KEY, JSON.stringify([...current.filter((item) => item.id !== rule.id), rule])); return rule; }
export function removeRule(id: string) { const current = read(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; setSetting(KEY, JSON.stringify(next)); return true; }
function readProviders(): RuleProvider[] { try { const raw = getSetting(PROVIDER_KEY); return raw ? JSON.parse(raw) as RuleProvider[] : []; } catch { return []; } }
export function listRuleProviders() { return readProviders(); }
export function listRuleProviderSnapshots(): RuleProviderSnapshots { const snapshots: RuleProviderSnapshots = {}; for (const provider of readProviders()) { const value = getSetting(`routing.rule-provider.snapshot.${provider.id}`); if (value) snapshots[provider.id] = value; } return snapshots; }
export function replaceRuleProviderSnapshots(value: unknown): RuleProviderSnapshots { const snapshots = value && typeof value === 'object' ? value as Record<string, unknown> : {}; const allowed = new Set(readProviders().map((provider) => provider.id)); const prefix = 'routing.rule-provider.snapshot.'; for (const key of listSettingKeys(prefix)) removeSetting(key); for (const id of Object.keys(snapshots)) { if (!allowed.has(id) || typeof snapshots[id] !== 'string') continue; setSetting(`${prefix}${id}`, snapshots[id] as string); setSetting(`${prefix}meta.${id}`, JSON.stringify({ updatedAt: Date.now(), bytes: Buffer.byteLength(snapshots[id] as string) })); } return listRuleProviderSnapshots(); }
export function replaceRuleProviders(value: unknown[]): RuleProvider[] { const before = readProviders(); const next = value.map((item) => upsertRuleProvider(item)); const ids = new Set(next.map((item) => item.id)); for (const old of before) if (!ids.has(old.id)) clearRuleProviderSnapshot(old.id); setSetting(PROVIDER_KEY, JSON.stringify(next)); return next; }
function clearRuleProviderSnapshot(id: string) { removeSetting(`routing.rule-provider.snapshot.${id}`); removeSetting(`routing.rule-provider.snapshot-meta.${id}`); }
export function upsertRuleProvider(input: unknown): RuleProvider { const row = input && typeof input === 'object' ? input as Record<string, unknown> : {}; const current = readProviders(); const id = String(row.id ?? `rule-provider-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64); const old = current.find((item) => item.id === id); const url = String(row.url ?? old?.url ?? '').slice(0, 500); if (old && old.url !== url) clearRuleProviderSnapshot(id); const behavior = row.behavior === 'classical' || row.behavior === 'ipcidr' ? row.behavior : old?.behavior ?? 'domain'; const provider: RuleProvider = { id, name: String(row.name ?? old?.name ?? id).slice(0, 80), url, behavior, interval: Math.max(300, Math.min(86400, Number(row.interval ?? old?.interval ?? 3600) || 3600)), enabled: typeof row.enabled === 'boolean' ? row.enabled : old?.enabled ?? true, updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : old?.updatedAt ?? null, lastError: typeof row.lastError === 'string' ? row.lastError : old?.lastError ?? null }; setSetting(PROVIDER_KEY, JSON.stringify([...current.filter((item) => item.id !== id), provider])); return provider; }
function validateContent(text: string, behavior: RuleProvider['behavior']) {
  const body = text.replace(/^\uFEFF/, '').trim();
  if (!body) throw new Error('规则内容为空');
  if (body.length > 5_000_000) throw new Error('规则内容超过 5 MB');
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#') && !line.startsWith('payload:'));
  if (!lines.length) throw new Error('规则内容没有有效条目');
  const valid = behavior === 'domain'
    ? lines.some((line) => /^[a-z0-9*.-]+$/i.test(line) || /^[-_a-z]+,/.test(line))
    : behavior === 'ipcidr'
      ? lines.some((line) => /\b\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?\b/.test(line) || /:/.test(line))
      : lines.some((line) => /^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD|IP-CIDR|IP-CIDR6|MATCH|PROCESS-NAME),/i.test(line));
  if (!valid) throw new Error(`规则内容与 ${behavior} 格式不匹配`);
  return body;
}

export async function refreshRuleProvider(id: string): Promise<RuleProvider> {
  const provider = readProviders().find((item) => item.id === id); if (!provider) throw new Error('规则 Provider 不存在');
  try {
    if (!provider.url) throw new Error('规则 Provider URL 为空');
    const response = await fetch(provider.url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'ProxyManager/0.1 rule-provider' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = validateContent(await response.text(), provider.behavior);
    setSetting(`routing.rule-provider.snapshot.${provider.id}`, text);
    setSetting(`routing.rule-provider.snapshot-meta.${provider.id}`, JSON.stringify({ updatedAt: Date.now(), bytes: Buffer.byteLength(text) }));
    return upsertRuleProvider({ ...provider, updatedAt: Date.now(), lastError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : '规则 Provider 更新失败'; upsertRuleProvider({ ...provider, lastError: message }); throw error;
  }
}

export function ruleProviderDue(provider: RuleProvider, now = Date.now()) {
  return provider.enabled && Boolean(provider.url) && (provider.updatedAt === null || now - provider.updatedAt >= provider.interval * 1000);
}
export function removeRuleProvider(id: string) { const current = readProviders(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; clearRuleProviderSnapshot(id); setSetting(PROVIDER_KEY, JSON.stringify(next)); return true; }
