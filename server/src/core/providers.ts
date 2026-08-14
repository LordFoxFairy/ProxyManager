import { getSetting, setSetting } from './store.js';

export type ProviderKind = 'subscription' | 'fixed' | 'pool' | 'isp' | 'residential';
export type ProviderNodeType = 'http' | 'socks5' | 'ss' | 'vmess' | 'vless' | 'trojan' | 'hysteria2' | 'tuic' | 'wireguard';
export interface ProviderNode { name: string; type: ProviderNodeType; server: string; port: number; [key: string]: unknown; }
export interface Provider { id: string; name: string; kind: ProviderKind; url: string | null; enabled: boolean; nodes: ProviderNode[]; sessionPolicy: 'rotating' | 'sticky' | 'fixed' | null; country: string | null; region: string | null; isp: string | null; expiresAt: number | null; updatedAt: number | null; lastError: string | null; }
const KEY = 'providers.catalog';
const read = (): Provider[] => { try { const value = JSON.parse(getSetting(KEY) ?? '[]'); if (!Array.isArray(value)) return []; return value.map((item) => normalizeProvider(item, value as Provider[])); } catch { return []; } };
const write = (value: Provider[]) => setSetting(KEY, JSON.stringify(value));
export function listProviders(): Provider[] { return read(); }
function normalizeProvider(input: unknown, current: Provider[]): Provider {
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const id = String(row.id ?? `provider-${Date.now()}`).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64);
  const previous = current.find((item) => item.id === id);
  const kind = row.kind === 'fixed' || row.kind === 'pool' || row.kind === 'isp' || row.kind === 'residential' ? row.kind : previous?.kind ?? 'subscription';
  const sessionPolicy = row.sessionPolicy === 'rotating' || row.sessionPolicy === 'sticky' || row.sessionPolicy === 'fixed' ? row.sessionPolicy : previous?.sessionPolicy ?? (kind === 'isp' || kind === 'residential' ? 'sticky' : null);
  const nullableText = (value: unknown, fallback: string | null) => typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : fallback;
  return { id, name: String(row.name ?? previous?.name ?? id).slice(0, 80), kind, url: typeof row.url === 'string' && row.url.trim() ? row.url.trim().slice(0, 2048) : previous?.url ?? null, enabled: typeof row.enabled === 'boolean' ? row.enabled : previous?.enabled ?? true, nodes: Array.isArray(row.nodes) ? normalizeNodes(row.nodes) : previous?.nodes ?? [], sessionPolicy, country: nullableText(row.country, previous?.country ?? null), region: nullableText(row.region, previous?.region ?? null), isp: nullableText(row.isp, previous?.isp ?? null), expiresAt: typeof row.expiresAt === 'number' ? row.expiresAt : previous?.expiresAt ?? null, updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : previous?.updatedAt ?? null, lastError: typeof row.lastError === 'string' ? row.lastError : previous?.lastError ?? null };
}
export function replaceProviders(value: unknown[]): Provider[] { const current = read(); const next = value.map((item) => normalizeProvider(item, current)); write(next); return next; }
export function upsertProvider(input: unknown): Provider {
  const current = read(); const provider = normalizeProvider(input, current);
  write([...current.filter((item) => item.id !== provider.id), provider]); return provider;
}
export function removeProvider(id: string): boolean { const current = read(); const next = current.filter((item) => item.id !== id); if (next.length === current.length) return false; write(next); return true; }
const NODE_TYPES = new Set<ProviderNodeType>(['http', 'socks5', 'ss', 'vmess', 'vless', 'trojan', 'hysteria2', 'tuic', 'wireguard']);
function normalizeNodes(input: unknown[]): ProviderNode[] { return input.map((item) => { const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}; const port = Number(row.port); const type = String(row.type ?? 'http').toLowerCase() as ProviderNodeType; if (!row.name || !row.server || !Number.isInteger(port) || port < 1 || port > 65535 || !NODE_TYPES.has(type)) return null; return { ...row, name: String(row.name).slice(0, 120), type, server: String(row.server).trim().slice(0, 255), port } as ProviderNode; }).filter((item): item is ProviderNode => Boolean(item)).slice(0, 500); }
function yamlValue(value: string): unknown {
  const clean = value.trim().replace(/\s+#.*$/, '');
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) return clean.slice(1, -1);
  if (clean === 'true' || clean === 'false') return clean === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  return clean;
}
function parseYamlBlock(block: string): Record<string, unknown> | null {
  const row: Record<string, unknown> = {};
  for (const [index, line] of block.split(/\r?\n/).entries()) {
    const match = index === 0
      ? /^\s*-\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line)
      : /^\s{2,}([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    const key = match?.[1];
    const raw = match?.[2];
    if (!key || !raw?.trim() || raw.trim() === 'null') continue;
    row[key] = yamlValue(raw);
  }
  const name = row.name;
  const type = row.type;
  const server = row.server;
  const port = row.port;
  return typeof name === 'string' && typeof type === 'string' && typeof server === 'string' && typeof port === 'number'
    ? row
    : null;
}
function decodeBase64(text: string): string | null { try { const decoded = Buffer.from(text.trim(), 'base64').toString('utf8'); return decoded.includes('://') || decoded.includes('proxies:') ? decoded : null; } catch { return null; } }
function parseUri(line: string): ProviderNode | null { try { const raw = line.trim(); if (raw.startsWith('vmess://')) { const decoded = Buffer.from(raw.slice(8), 'base64').toString('utf8'); const row = JSON.parse(decoded) as Record<string, unknown>; return normalizeNodes([{ ...row, name: row.ps ?? row.name, type: 'vmess', server: row.add ?? row.server, port: row.port }])[0] ?? null; } const url = new URL(raw); const port = Number(url.port); const scheme = url.protocol.replace(':', '').toLowerCase() as ProviderNodeType; if (!url.hostname || !Number.isInteger(port) || port < 1 || port > 65535 || !NODE_TYPES.has(scheme)) return null; const node: Record<string, unknown> = { name: decodeURIComponent(url.hash.slice(1)) || `${scheme}-${url.hostname}:${port}`, type: scheme, server: url.hostname, port }; if (url.username) node.uuid = decodeURIComponent(url.username); if (url.password) node.password = decodeURIComponent(url.password); for (const [key, value] of url.searchParams) node[key] = value; return normalizeNodes([node])[0] ?? null; } catch { return null; } }
function parseText(text: string): ProviderNode[] { let value: unknown = null; try { value = JSON.parse(text); } catch {} if (value && typeof value === 'object' && Array.isArray((value as Record<string, unknown>).proxies)) return normalizeNodes((value as Record<string, unknown>).proxies as unknown[]); const source = decodeBase64(text) ?? text; const uriNodes = source.split(/\r?\n/).map(parseUri).filter((node): node is ProviderNode => Boolean(node)); if (uriNodes.length) return uriNodes; return normalizeNodes(source.split(/\n(?=\s*-\s*name\s*:)/).map(parseYamlBlock).filter((row): row is Record<string, unknown> => Boolean(row))); }
export async function refreshProvider(id: string): Promise<Provider> {
  const provider = read().find((item) => item.id === id);
  if (!provider) throw new Error('Provider 不存在');
  if (!provider.url) throw new Error('Provider 没有 URL');
  try {
    const response = await fetch(provider.url, { signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'ProxyManager/0.1 provider' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const nodes = parseText(await response.text());
    if (!nodes.length) throw new Error('未解析出可用节点');
    return upsertProvider({ ...provider, nodes, updatedAt: Date.now(), lastError: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Provider 更新失败';
    upsertProvider({ ...provider, lastError: message });
    throw error;
  }
}
export function providerNodes(): ProviderNode[] { return read().filter((provider) => provider.enabled).flatMap((provider) => provider.nodes); }
