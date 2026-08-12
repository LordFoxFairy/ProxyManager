import net from 'node:net';

export interface IpProfile {
  ip: string;
  country: string | null;
  region: string | null;
  city: string | null;
  isp: string | null;
  org: string | null;
  asn: string | null;
  proxy: boolean | null;
  hosting: boolean | null;
  mobile: boolean | null;
}

const text = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;

export async function lookupIpProfile(ip: string): Promise<IpProfile | null> {
  if (!net.isIP(ip)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,query,countryCode,regionName,city,isp,org,as,proxy,hosting,mobile`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const row = await response.json() as Record<string, unknown>;
    if (row.status !== 'success' || typeof row.query !== 'string') return null;
    return {
      ip: row.query,
      country: text(row.countryCode),
      region: text(row.regionName),
      city: text(row.city),
      isp: text(row.isp),
      org: text(row.org),
      asn: text(row.as),
      proxy: typeof row.proxy === 'boolean' ? row.proxy : null,
      hosting: typeof row.hosting === 'boolean' ? row.hosting : null,
      mobile: typeof row.mobile === 'boolean' ? row.mobile : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
