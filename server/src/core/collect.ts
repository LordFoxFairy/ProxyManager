import { SOURCES, type SourceConfig } from '../config.js';
import {
  addCandidates,
  exhumeExpired,
  getSetting,
  graveyardSize,
  setSetting,
} from './store.js';

/** Accepts `socks5://1.2.3.4:1080` and bare `1.2.3.4:1080`. */
const LINE = /^(?:(https?|socks[45]):\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

export function parse(text: string, fallback: string | null) {
  const out: { addr: string; scheme: string }[] = [];
  for (const raw of text.split('\n')) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const [, proto, host, portStr] = m;
    const port = Number(portStr);
    if (!(port > 0 && port < 65536)) continue;
    if (host!.split('.').some((o) => Number(o) > 255)) continue;
    const scheme = proto ?? fallback;
    if (!scheme) continue;
    // An https:// entry still speaks the HTTP proxy protocol.
    out.push({ addr: `${host}:${port}`, scheme: scheme === 'https' ? 'http' : scheme });
  }
  return out;
}

const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
};

const stripHtml = (text: string) => {
  const withoutCode = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n');
  return Object.entries(HTML_ENTITIES).reduce(
    (value, [entity, replacement]) => value.replaceAll(entity, replacement),
    withoutCode,
  );
};

/** Parse the public Zdaye table where IP, port and protocol live in adjacent cells. */
export function parseZdaye(text: string) {
  const tokens = stripHtml(text)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const rows: { addr: string; scheme: string }[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const host = /^(\d{1,3}(?:\.\d{1,3}){3})$/.exec(tokens[index] ?? '')?.[1];
    if (!host || host.split('.').some((octet) => Number(octet) > 255)) continue;

    let port: number | null = null;
    let scheme: string | null = null;
    for (const token of tokens.slice(index + 1, index + 14)) {
      const portMatch = /^(?:Port|端口)\s*[:\uFF1A]\s*(\d{1,5})$/i.exec(token);
      if (portMatch) port = Number(portMatch[1]);
      const protocolMatch = /^(HTTPS?|SOCKS[45])$/i.exec(token);
      if (protocolMatch) {
        const protocol = protocolMatch[1]!.toLowerCase();
        scheme = protocol === 'https' ? 'http' : protocol;
      }
      if (port && scheme) break;
    }

    if (!port || port >= 65536 || !scheme) continue;
    const addr = `${host}:${port}`;
    const key = `${scheme}://${addr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ addr, scheme });
  }
  return rows;
}

interface SourceRuntime {
  running: boolean;
  lastRun: number | null;
  lastCandidates: number | null;
  durationMs: number | null;
  lastError: string | null;
}

const runtime = new Map<string, SourceRuntime>();

const sourceRuntime = (name: string): SourceRuntime => {
  let value = runtime.get(name);
  if (!value) {
    value = { running: false, lastRun: null, lastCandidates: null, durationMs: null, lastError: null };
    runtime.set(name, value);
  }
  return value;
};

const sourceKey = (name: string) => `source.${name}.enabled`;

export const sourceExists = (name: string) => SOURCES.some((source) => source.name === name);

export const sourceEnabled = (name: string) => {
  const stored = getSetting(sourceKey(name));
  if (stored !== null) return stored !== '0';
  return SOURCES.find((source) => source.name === name)?.recommended ?? false;
};

export function setSourceEnabled(name: string, enabled: boolean): boolean {
  if (!sourceExists(name)) return false;
  setSetting(sourceKey(name), enabled ? '1' : '0');
  return true;
}

export function sourceStatuses() {
  return SOURCES.map((source) => ({
    ...source,
    enabled: sourceEnabled(source.name),
    ...sourceRuntime(source.name),
  }));
}

const sourceUrls = (source: SourceConfig) => {
  if (source.format !== 'zdaye') return [source.url];
  return Array.from({ length: Math.max(1, source.pages ?? 1) }, (_, index) =>
    index === 0 ? source.url : `${source.url}${index + 1}/`,
  );
};

async function fetchSource(s: SourceConfig, log: (m: string) => void) {
  const status = sourceRuntime(s.name);
  const startedAt = Date.now();
  status.running = true;
  status.lastError = null;
  try {
    const rows: { addr: string; scheme: string }[] = [];
    const failures: string[] = [];
    for (const url of sourceUrls(s)) {
      try {
        const res = await fetch(url, {
          headers: {
            accept: 'text/plain,text/html;q=0.9,*/*;q=0.7',
            'user-agent': 'ProxyManager/0.1 public-source-collector',
          },
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.text();
        rows.push(...(s.format === 'zdaye' ? parseZdaye(body) : parse(body, s.scheme)));
      } catch (error) {
        failures.push((error as Error).message);
      }
    }
    if (!rows.length && failures.length) throw new Error(failures[0]);
    if (failures.length) log(`  ${s.name}: ${failures.length} page(s) unavailable`);
    status.lastCandidates = rows.length;
    log(`  ${s.name}: ${rows.length} candidates`);
    return rows.map((r) => ({ ...r, source: s.name }));
  } catch (e) {
    status.lastCandidates = 0;
    status.lastError = (e as Error).message;
    log(`  ${s.name}: FAILED (${status.lastError})`);
    return [];
  } finally {
    status.running = false;
    status.lastRun = Date.now();
    status.durationMs = Date.now() - startedAt;
  }
}

/** Pull every source in parallel, dedupe, insert. Returns count of new rows. */
export async function collect(log: (m: string) => void = console.log, names?: string[]) {
  // Give long-buried addresses another chance before pulling fresh lists.
  const revived = exhumeExpired();
  if (revived) log(`  exhumed ${revived} expired tombstones`);

  const selected = names?.length
    ? SOURCES.filter((source) => names.includes(source.name))
    : SOURCES.filter((source) => sourceEnabled(source.name));
  if (!selected.length) {
    log('no collection sources selected');
    return { unique: 0, added: 0 };
  }

  const batches = await Promise.all(selected.map((s) => fetchSource(s, log)));

  const seen = new Set<string>();
  const rows: { addr: string; scheme: string; source: string }[] = [];
  for (const r of batches.flat()) {
    if (seen.has(r.addr)) continue;
    seen.add(r.addr);
    rows.push(r);
  }

  const added = rows.length ? addCandidates(rows) : 0;
  log(`collected ${rows.length} unique, ${added} new (${graveyardSize()} buried)`);
  return { unique: rows.length, added };
}
