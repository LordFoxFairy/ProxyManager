import { randomUUID } from 'node:crypto';
import net from 'node:net';

const SESSION_TTL_MS = 5 * 60_000;

export interface BrowserEvidence {
  ipv4: string | null;
  ipv6: string | null;
  webrtcPublic: string[];
  webrtcPrivate: string[];
  webrtcMdns: boolean;
  timezone: string | null;
  language: string | null;
  languages: string[];
  userAgent: string | null;
  platform: string | null;
  screen: string | null;
  collectedAt: number;
}

export interface BrowserDiagnosticSession {
  id: string;
  createdAt: number;
  expiresAt: number;
  state: 'pending' | 'complete' | 'expired';
  evidence: BrowserEvidence | null;
}

const sessions = new Map<string, BrowserDiagnosticSession>();

function cleanup() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now && session.state !== 'expired') {
      session.state = 'expired';
    }
    if (session.expiresAt + SESSION_TTL_MS <= now) sessions.delete(id);
  }
}

export function createBrowserDiagnosticSession(): BrowserDiagnosticSession {
  cleanup();
  const now = Date.now();
  const session: BrowserDiagnosticSession = {
    id: randomUUID(),
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    state: 'pending',
    evidence: null,
  };
  sessions.set(session.id, session);
  return session;
}

export function getBrowserDiagnosticSession(id: string): BrowserDiagnosticSession | null {
  cleanup();
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) session.state = 'expired';
  return session;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

function ipList(value: unknown, version: 4 | 6): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && net.isIP(item) === version).slice(0, 12))];
}

export function recordBrowserDiagnosticEvidence(id: string, input: unknown): BrowserDiagnosticSession | null {
  const session = getBrowserDiagnosticSession(id);
  if (!session || session.state === 'expired') return null;
  const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const evidence: BrowserEvidence = {
    ipv4: typeof row.ipv4 === 'string' && net.isIP(row.ipv4) === 4 ? row.ipv4 : null,
    ipv6: typeof row.ipv6 === 'string' && net.isIP(row.ipv6) === 6 ? row.ipv6 : null,
    webrtcPublic: ipList(row.webrtcPublic, 4).concat(ipList(row.webrtcPublic, 6)),
    webrtcPrivate: ipList(row.webrtcPrivate, 4).concat(ipList(row.webrtcPrivate, 6)),
    webrtcMdns: row.webrtcMdns === true,
    timezone: text(row.timezone, 96),
    language: text(row.language, 32),
    languages: Array.isArray(row.languages) ? row.languages.filter((item): item is string => typeof item === 'string').slice(0, 12).map((item) => item.slice(0, 32)) : [],
    userAgent: text(row.userAgent, 512),
    platform: text(row.platform, 128),
    screen: text(row.screen, 64),
    collectedAt: Date.now(),
  };
  session.evidence = evidence;
  session.state = 'complete';
  return session;
}

export function renderBrowserDiagnosticPage(id: string): string {
  const safeId = JSON.stringify(id);
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ProxyManager 浏览器诊断</title>
<style>body{margin:0;background:#f6f5f2;color:#0f172a;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:720px;margin:48px auto;padding:0 20px}section{background:#fff;border:1px solid #dfe5ec;border-radius:10px;padding:22px;box-shadow:0 8px 24px #0f172a12}h1{font-size:22px;margin:0 0 8px}p{color:#64748b;line-height:1.65}#status{margin-top:18px;padding:12px;background:#eff6ff;border-radius:7px;color:#1d4ed8}dl{display:grid;grid-template-columns:150px 1fr;gap:10px;margin-top:18px}dt{color:#64748b}dd{margin:0;word-break:break-word;font-family:ui-monospace,SFMono-Regular,monospace}@media(max-width:600px){main{margin:20px auto}dl{grid-template-columns:1fr;gap:3px}dd{margin-bottom:8px}}</style></head>
<body><main><section><h1>ProxyManager 浏览器诊断</h1><p>此页面采集当前浏览器的真实网络出口和环境信息，并仅回传给本机 ProxyManager。页面完成后可以直接关闭。</p><div id="status">正在采集浏览器证据...</div><dl id="details"></dl></section></main>
<script>
const SESSION_ID=${safeId};
const statusEl=document.getElementById('status'); const detailsEl=document.getElementById('details');
const setStatus=(text)=>statusEl.textContent=text;
const show=(rows)=>detailsEl.innerHTML=rows.map(([k,v])=>'<dt>'+k+'</dt><dd>'+String(v??'未获取').replace(/[&<>]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</dd>').join('');
async function ip(url, version){try{const res=await fetch(url,{cache:'no-store'});const data=await res.json();const value=String(data.ip||'').trim();return value||(version===6?null:null)}catch{return null}}
async function webrtc(){const publicIps=new Set(), privateIps=new Set();let mdns=false; if(!window.RTCPeerConnection)return {publicIps:[],privateIps:[],mdns:false};
  try{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});pc.createDataChannel('proxymanager');pc.onicecandidate=(event)=>{const c=event.candidate?.candidate||'';const match=c.match(/(?:^| )([0-9a-f:.]+|[a-z0-9-]+\.local)(?: |$)/i);if(!match)return;const value=match[1];if(value.endsWith('.local')){mdns=true;return}const type=(c.match(/ typ (host|srflx|relay)/)||[])[1];if(type==='host')privateIps.add(value);else publicIps.add(value)};const offer=await pc.createOffer();await pc.setLocalDescription(offer);await new Promise((resolve)=>setTimeout(resolve,3500));pc.close()}catch{} return {publicIps:[...publicIps],privateIps:[...privateIps],mdns};}
async function run(){const [ipv4,ipv6,rtc]=await Promise.all([ip('https://api.ipify.org?format=json',4),ip('https://api6.ipify.org?format=json',6),webrtc()]);const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||null;const evidence={ipv4,ipv6,webrtcPublic:rtc.publicIps,webrtcPrivate:rtc.privateIps,webrtcMdns:rtc.mdns,timezone,language:navigator.language||null,languages:navigator.languages||[],userAgent:navigator.userAgent||null,platform:navigator.platform||null,screen:screen.width+'x'+screen.height+' @ '+devicePixelRatio+'x'};show([['IPv4',ipv4],['IPv6',ipv6],['WebRTC 公网候选',rtc.publicIps.join(', ')||'未发现'],['WebRTC 本地候选',rtc.privateIps.join(', ')||'未发现'],['mDNS',rtc.mdns?'已启用':'未发现'],['时区',timezone],['语言',navigator.languages?.join(', ')||navigator.language]]);setStatus('证据已采集，正在回传 ProxyManager...');try{const res=await fetch('/diagnostics/browser/'+SESSION_ID+'/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(evidence)});if(!res.ok)throw new Error();setStatus('诊断完成，可以关闭此页面。')}catch{setStatus('回传失败，请保持页面打开并重试。')}}run();
</script></body></html>`;
}
