import { getSetting, setSetting } from './store.js';

export type RuleKind = 'DOMAIN' | 'DOMAIN-SUFFIX' | 'DOMAIN-KEYWORD' | 'IP-CIDR' | 'PROCESS-NAME' | 'MATCH';
export interface RoutingRule { id: string; kind: RuleKind; value: string; target: string; enabled: boolean; }
export interface RuleProvider { id: string; name: string; url: string; behavior: 'domain' | 'classical' | 'ipcidr'; interval: number; enabled: boolean; updatedAt: number | null; lastError: string | null; }
const KEY = 'routing.rules';
const PROVIDER_KEY = 'routing.rule-providers';
const defaults: RoutingRule[] = [];
function read(): RoutingRule[] { try { const raw = getSetting(KEY); return raw ? JSON.parse(raw) as RoutingRule[] : defaults; } catch { return defaults; } }
export function listRules() { return read(); }
export function replaceRules(value: unknown[]): RoutingRule[] { const next = value.map((item) => upsertRule(item)); const ids = new Set(next.map((item) => item.id)); setSetting(KEY, JSON.stringify(read().filter((item) => ids.has(item.id)))); return next; }
export function upsertRule(input: unknown): RoutingRule { const row = input && typeof input === 'object' ? input as Record<string, unknown> : {}; const current = read(); const id = String(row.id ?? `rule-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64); const old = current.find((item) => item.id === id); const kinds: RuleKind[] = ['DOMAIN', 'DOMAIN-SUFFIX', 'DOMAIN-KEYWORD', 'IP-CIDR', 'PROCESS-NAME', 'MATCH']; const kind = kinds.includes(row.kind as RuleKind) ? row.kind as RuleKind : old?.kind ?? 'DOMAIN-SUFFIX'; const rule: RoutingRule = { id, kind, value: String(row.value ?? old?.value ?? '').slice(0, 255), target: String(row.target ?? old?.target ?? 'PROXY').slice(0, 80), enabled: typeof row.enabled === 'boolean' ? row.enabled : old?.enabled ?? true }; setSetting(KEY, JSON.stringify([...current.filter((item) => item.id !== id), rule])); return rule; }
export function removeRule(id: string) { const current = read(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; setSetting(KEY, JSON.stringify(next)); return true; }
function readProviders(): RuleProvider[] { try { const raw = getSetting(PROVIDER_KEY); return raw ? JSON.parse(raw) as RuleProvider[] : []; } catch { return []; } }
export function listRuleProviders() { return readProviders(); }
export function replaceRuleProviders(value: unknown[]): RuleProvider[] { const next = value.map((item) => upsertRuleProvider(item)); const ids = new Set(next.map((item) => item.id)); setSetting(PROVIDER_KEY, JSON.stringify(readProviders().filter((item) => ids.has(item.id)))); return next; }
export function upsertRuleProvider(input: unknown): RuleProvider { const row = input && typeof input === 'object' ? input as Record<string, unknown> : {}; const current = readProviders(); const id = String(row.id ?? `rule-provider-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64); const old = current.find((item) => item.id === id); const behavior = row.behavior === 'classical' || row.behavior === 'ipcidr' ? row.behavior : old?.behavior ?? 'domain'; const provider: RuleProvider = { id, name: String(row.name ?? old?.name ?? id).slice(0, 80), url: String(row.url ?? old?.url ?? '').slice(0, 500), behavior, interval: Math.max(300, Math.min(86400, Number(row.interval ?? old?.interval ?? 3600) || 3600)), enabled: typeof row.enabled === 'boolean' ? row.enabled : old?.enabled ?? true, updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : old?.updatedAt ?? null, lastError: typeof row.lastError === 'string' ? row.lastError : old?.lastError ?? null }; setSetting(PROVIDER_KEY, JSON.stringify([...current.filter((item) => item.id !== id), provider])); return provider; }
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
export function removeRuleProvider(id: string) { const current = readProviders(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; setSetting(PROVIDER_KEY, JSON.stringify(next)); return true; }
