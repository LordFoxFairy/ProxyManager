import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getRuntimeConfig, type RuntimeConfig } from './runtime.js';
import { get, type Proxy } from './store.js';
import { providerNodes } from './providers.js';

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
  'proxy-groups': [{ name: 'PROXY'; type: 'select'; proxies: string[] }];
  rules: string[];
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
  return {
    'mixed-port': config.mixedPort,
    'allow-lan': false,
    mode: config.mode,
    'log-level': 'info',
    'external-controller': controller,
    secret,
    proxies: merged,
    'proxy-groups': [{ name: 'PROXY', type: 'select', proxies: [...names, 'DIRECT'] }],
    rules: ['MATCH,PROXY'],
  };
}

export function validateMihomoConfig(config: RuntimeConfig): string[] {
  const errors: string[] = [];
  const ports = [config.mixedPort, config.httpPort, config.socksPort];
  if (ports.some((port) => !Number.isInteger(port) || port < 1024 || port > 65535)) errors.push('端口必须在 1024-65535');
  if (new Set(ports).size !== ports.length) errors.push('mixed/http/socks 端口不能重复');
  if (!['rule', 'global', 'direct'].includes(config.mode)) errors.push('不支持的运行模式');
  return errors;
}

export class MihomoController {
  private child: ChildProcess | null = null;
  private lastError: string | null = null;
  private configPath: string | null = null;

  get running() { return Boolean(this.child && this.child.exitCode === null); }
  get error() { return this.lastError; }
  get path() { return this.configPath; }

  async start(config = getRuntimeConfig()): Promise<void> {
    if (this.running) return;
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
      if (code !== 0 && signal !== 'SIGTERM') this.lastError = `Mihomo 已退出 (${code ?? signal ?? 'unknown'})`;
      this.child = null;
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    const child = this.child;
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.child = null;
  }
}

export const mihomo = new MihomoController();
