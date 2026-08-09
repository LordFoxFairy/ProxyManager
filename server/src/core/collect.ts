import { SOURCES } from '../config.js';
import { addCandidates } from './store.js';

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

async function fetchSource(s: (typeof SOURCES)[number], log: (m: string) => void) {
  try {
    const res = await fetch(s.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parse(await res.text(), s.scheme);
    log(`  ${s.name}: ${rows.length} candidates`);
    return rows.map((r) => ({ ...r, source: s.name }));
  } catch (e) {
    log(`  ${s.name}: FAILED (${(e as Error).message})`);
    return [];
  }
}

/** Pull every source in parallel, dedupe, insert. Returns count of new rows. */
export async function collect(log: (m: string) => void = console.log) {
  const batches = await Promise.all(SOURCES.map((s) => fetchSource(s, log)));

  const seen = new Set<string>();
  const rows: { addr: string; scheme: string; source: string }[] = [];
  for (const r of batches.flat()) {
    if (seen.has(r.addr)) continue;
    seen.add(r.addr);
    rows.push(r);
  }

  const added = rows.length ? addCandidates(rows) : 0;
  log(`collected ${rows.length} unique, ${added} new`);
  return { unique: rows.length, added };
}
