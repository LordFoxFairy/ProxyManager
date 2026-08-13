import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRuntimeConfig, type RuntimeConfig } from './runtime.js';
import { get, type Proxy } from './store.js';
import { providerNodes } from './providers.js';
import { listGroups } from './groups.js';
import { listRuleProviders, listRules } from './rules.js';

export interface MihomoProxy {
  name: string;
  type: 'http' | 'socks5';
  server: string;
  port: number;
  udp: boolean;
}

export interface MihomoConfig {
  'mixed-port': number;
  'allow-lan': false;
  mode: 'rule' | 'global' | 'direct';
  'log-level': 'info';
  'external-controller': string;
  secret: string;
  proxies: MihomoProxy[];
  'proxy-groups': { name: string; type: string; proxies: string[]; url?: string; interval?: number; tolerance?: number }[];
  rules: string[];
  'rule-providers'?: Record<string, { type: 'http'; behavior: 'domain' | 'classical' | 'ipcidr'; url: string; path: string; interval: number }>;
  dns?: { enable: true; listen: string; 'enhanced-mode': 'fake-ip' | 'redir-host'; nameserver: string[]; fallback: string[] };
  tun?: { enable: true; stack: 'system' | 'gvisor' | 'mixed'; 'auto-route': boolean; 'auto-detect-interface': boolean; 'dns-hijack': string[] };
}

export interface MihomoConnection {
  id: string;
  metadata?: { host?: string; destinationIP?: string; destinationPort?: string; network?: string; type?: string; process?: string };
  chains?: string[];
  upload?: number;
  download?: number;
  start?: string;
  rule?: string;
  rulePayload?: string;
}

function nodeToMihomo(proxy: Proxy, index: number): MihomoProxy | null {
  const [server, portText] = proxy.addr.split(':');
  const port = Number(portText);
  if (!server || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { name: `POOL-${index + 1}-${proxy.country ?? 'XX'}`, type: proxy.scheme === 'socks5' ? 'socks5' : 'http', server, port, udp: false };
}

export function buildMihomoConfig(config: RuntimeConfig, controller = '127.0.0.1:9090', secret = '', nodes: Proxy[] = get({ n: 200, minScore: 1, https: true })): MihomoConfig {
  const proxies = nodes.map(nodeToMihomo).filter((node): node is MihomoProxy => Boolean(node));
  const external = providerNodes().filter((node) => node.type === 'http' || node.type === 'socks5').map((node) => ({ ...node, udp: false })) as MihomoProxy[];
  const merged = [...new Map([...proxies, ...external].map((node) => [node.name, node])).values()];
  const names = merged.map((proxy) => proxy.name);
  const available = new Set([...names, 'DIRECT']);
  const groups: MihomoConfig['proxy-groups'] = listGroups().filter((group) => group.enabled).map((group) => ({ name: group.name, type: group.kind, proxies: group.name === 'PROXY' ? [...names, ...group.members.filter((member) => member === 'DIRECT')] : group.members.filter((member) => available.has(member) || member === 'PROXY'), url: group.url, interval: group.interval, tolerance: group.tolerance }));
  if (!groups.some((group) => group.name === 'PROXY')) groups.unshift({ name: 'PROXY', type: 'select', proxies: [...names, 'DIRECT'] });
  const ruleProviders = Object.fromEntries(listRuleProviders().filter((provider) => provider.enabled && provider.url).map((provider) => [provider.name, { type: 'http' as const, behavior: provider.behavior, url: provider.url, path: `./rule-providers/${provider.id}.yaml`, interval: provider.interval }]));
  const providerRules = listRuleProviders().filter((provider) => provider.enabled && provider.url).map((provider) => `RULE-SET,${provider.name},PROXY`);
  return {
    'mixed-port': config.mixedPort,
    'allow-lan': false,
    mode: config.mode,
    'log-level': 'info',
    'external-controller': controller,
    secret,
    proxies: merged,
    'proxy-groups': groups,
    rules: [...listRules().filter((rule) => rule.enabled && rule.value).map((rule) => `${rule.kind},${rule.value},${rule.target}`), ...providerRules, 'MATCH,PROXY'],
    ...(Object.keys(ruleProviders).length ? { 'rule-providers': ruleProviders } : {}),
    ...(config.dns ? { dns: { enable: true as const, listen: config.dnsListen, 'enhanced-mode': config.dnsMode, nameserver: config.dnsNameservers, fallback: ['https://1.1.1.1/dns-query', 'https://8.8.8.8/dns-query'] } } : {}),
    ...(config.tun ? { tun: { enable: true as const, stack: config.tunStack, 'auto-route': config.tunAutoRoute, 'auto-detect-interface': config.tunAutoDetectInterface, 'dns-hijack': config.tunDnsHijack } } : {}),
  };
}

export function validateMihomoConfig(config: RuntimeConfig): string[] {
  const errors: string[] = [];
  const ports = [config.mixedPort, config.httpPort, config.socksPort];
  if (ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) errors.push('端口必须在 1024-65535');
  if (new Set(ports).size !== ports.length) errors.push('mixed/http/socks 端口不能重复');
  if (!['rule', 'global', 'direct'].includes(config.mode)) errors.push('不支持的运行模式');
  if (!/^((127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\]):)?\d+$/.test(config.dnsListen) && !/^\[[0-9a-f:]+\]:\d+$/i.test(config.dnsListen)) errors.push('DNS 监听地址格式无效');
  if (config.dnsNameservers.length === 0) errors.push('至少配置一个 DNS 上游');
  return errors;
}

export class MihomoController {
  private child: ChildProcess | null = null;
  private lastError: string | null = null;
  private configPath: string | null = null;
  private intentionalStop = false;
  private recoveryAttempts = 0;
  private recoveryTimer: NodeJS.Timeout | null = null;

  get running() { return Boolean(this.child && this.child.exitCode === null); }
  get error() { return this.lastError; }
  get path() { return this.configPath; }
  get recovering() { return this.recoveryTimer !== null; }

  async connections(): Promise<MihomoConnection[]> {
    const controller = process.env.PM_MIHOMO_CONTROLLER ?? '127.0.0.1:9090';
    if (!this.running) return [];
    const signal = AbortSignal.timeout(1200);
    try {
      const response = await fetch(`http://${controller}/connections`, { signal });
      if (!response.ok) return [];
      const body = await response.json() as { connections?: MihomoConnection[] };
      return Array.isArray(body.connections) ? body.connections.slice(0, 100) : [];
    } catch { return []; }
  }

  async start(config = getRuntimeConfig()): Promise<void> {
    if (this.running) return;
    if (this.recoveryTimer) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
    this.intentionalStop = false;
    const binary = process.env.PM_MIHOMO_BIN;
    if (!binary) throw new Error('未配置 PM_MIHOMO_BIN');
    const errors = validateMihomoConfig(config);
    if (errors.length) throw new Error(errors.join('；'));
    const directory = process.env.PM_MIHOMO_DIR ?? join(process.cwd(), '.runtime', 'mihomo');
    await mkdir(directory, { recursive: true });
    this.configPath = join(directory, 'config.json');
    await writeFile(this.configPath, JSON.stringify(buildMihomoConfig(config), null, 2), 'utf8');
    this.lastError = null;
    this.child = spawn(binary, ['-d', directory, '-f', this.configPath], { stdio: 'ignore' });
    this.child.once('error', (error) => { this.lastError = error.message; this.child = null; });
    this.child.once('exit', (code, signal) => {
      if (!this.intentionalStop && (code !== 0 || signal !== 'SIGTERM')) {
        this.lastError = `Mihomo 已退出 (${code ?? signal ?? 'unknown'})`;
        this.scheduleRecovery(config);
      }
      this.child = null;
    });
    await new Promise<void>((resolve, reject) => {
      const child = this.child!;
      const timer = setTimeout(() => resolve(), 300);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`Mihomo 启动失败 (${code ?? signal ?? 'unknown'})`)); });
    });
  }

  async stop(): Promise<void> {
    this.intentionalStop = true;
    this.recoveryAttempts = 0;
    if (this.recoveryTimer) { clearTimeout(this.recoveryTimer); this.recoveryTimer = null; }
    if (!this.child) return;
    const child = this.child;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.child = null;
  }

  private scheduleRecovery(config: RuntimeConfig) {
    if (this.recoveryTimer || this.recoveryAttempts >= 3) return;
    const delay = 500 * 2 ** this.recoveryAttempts;
    this.recoveryAttempts += 1;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.start(config).then(() => { this.recoveryAttempts = 0; }).catch(() => this.scheduleRecovery(config));
    }, delay);
  }
}

export const mihomo = new MihomoController();
