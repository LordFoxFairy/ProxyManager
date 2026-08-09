import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Boxes,
  Check,
  Copy,
  Database,
  Gauge,
  Globe,
  Layers,
  Plug,
  Lock,
  Radio,
  RefreshCw,
  Rocket,
  ScrollText,
  Settings,
  Trash2,
  Zap,
} from 'lucide-react';
import { Empty, Notice, Score, SchemeBadge, Stat, fmtAge } from './components/Pieces';
import {
  getGateway,
  getLog,
  getProxies,
  getStats,
  refresh,
  removeProxy,
  setStrategy,
  type Gateway,
  type Proxy,
  type Stats,
  type Strategy,
} from './lib/api';
import './styles/base.css';
import './styles/app.css';

type Page = 'dashboard' | 'gateway' | 'pool' | 'sources' | 'log';

const NAV: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: '仪表盘', icon: Gauge },
  { id: 'gateway', label: '本地代理', icon: Plug },
  { id: 'pool', label: '代理池', icon: Boxes },
  { id: 'sources', label: '采集源', icon: Layers },
  { id: 'log', label: '运行日志', icon: ScrollText },
];

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: 'url-test', label: '最优节点', hint: '选最快的,带迟滞防抖动' },
  { id: 'round-robin', label: '依次轮换', hint: '分摊请求,避免单 IP 触发风控' },
  { id: 'random', label: '随机', hint: '每次随机挑一个' },
];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [gw, setGw] = useState<Gateway | null>(null);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [onlyHttps, setOnlyHttps] = useState(false);
  const [scheme, setScheme] = useState<string>('');
  const [copied, setCopied] = useState<string>('');

  const load = useCallback(async () => {
    try {
      const [s, g, p, l] = await Promise.all([
        getStats(),
        getGateway(),
        getProxies({ n: 200, https: onlyHttps, scheme: scheme || undefined }),
        getLog(),
      ]);
      setStats(s);
      setGw(g);
      setProxies(p.proxies);
      setLines(l.lines);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [onlyHttps, scheme]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const copy = (url: string) => {
    void navigator.clipboard.writeText(url);
    setCopied(url);
    setTimeout(() => setCopied((c) => (c === url ? '' : c)), 1200);
  };

  const drop = async (addr: string) => {
    await removeProxy(addr).catch(() => {});
    void load();
  };

  const busy = stats?.running ?? false;

  return (
    <div className="app">
      <nav className="sidenav">
        <div className="brand">
          <span className="brand-mark">
            <Rocket size={22} />
          </span>
          <span className="brand-name">ProxyManager</span>
        </div>
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={`nav-item${page === id ? ' active' : ''}`}
            onClick={() => setPage(id)}
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
        <div className="nav-spacer" />
        <button className="nav-item">
          <Settings size={18} />
          设置
        </button>
      </nav>

      <main className="main">
        <h1 className="page-title">
          {NAV.find((n) => n.id === page)?.label}
          {busy && <RefreshCw size={18} className="spin" />}
        </h1>

        {offline && (
          <Notice danger>
            <strong>无法连接后端服务</strong>
            <br />
            开发模式请先启动:<code> cd server &amp;&amp; npm run dev serve</code>
            <br />
            打包版本依赖系统已安装 Node.js —— 请确认 <code>node -v</code> 可用。
          </Notice>
        )}

        {!offline && gw && !gw.running && (
          <Notice danger>
            <strong>本地代理端口未能启动</strong>
            <br />
            端口可能被占用(Clash/mihomo 默认使用 7890)。设置
            <code> PM_GATEWAY_PORT</code> 换一个端口后重启。
          </Notice>
        )}

        {stats?.lastError && <Notice danger>上次运行出错:{stats.lastError}</Notice>}

        {page === 'dashboard' && stats && (
          <>
            <div className="stat-grid">
              <Stat
                label="可用代理"
                icon={<Activity size={13} />}
                value={stats.live}
                tone="accent"
                sub={`共采集 ${stats.total.toLocaleString()} 个候选`}
              />
              <Stat
                label="支持 HTTPS"
                icon={<Lock size={13} />}
                value={stats.liveHttps}
                tone="good"
                sub={
                  stats.live
                    ? `占可用的 ${Math.round((stats.liveHttps / stats.live) * 100)}%`
                    : '—'
                }
              />
              <Stat
                label="平均延迟"
                icon={<Zap size={13} />}
                value={stats.avgLatency ? `${stats.avgLatency}ms` : '—'}
                tone="warn"
              />
              <Stat
                label="待校验"
                icon={<Database size={13} />}
                value={stats.unchecked.toLocaleString()}
                sub={stats.lastRun ? `上次 ${fmtAge(stats.lastRun)}` : '尚未运行'}
              />
            </div>

            <Notice>
              <strong>为什么「支持 HTTPS」才是关键指标</strong>
              <br />
              实测中 socks4 代理只有约 <strong>4%</strong> 能建立 HTTPS
              CONNECT 隧道,socks5 约 <strong>51%</strong>。由于真实业务流量绝大多数是
              HTTPS,只看「可用代理」总数会高估池子实际能力约一倍。取用时建议加
              <code> ?https=true</code>。
            </Notice>

            <div className="card toolbar">
              <span className="muted">
                状态:{busy ? (stats.phase === 'collecting' ? '采集中' : '校验中') : '空闲'}
              </span>
              <span className="grow" />
              <button className="btn" disabled={busy} onClick={() => refresh(false).then(load)}>
                <RefreshCw size={15} />
                仅校验
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => refresh(true).then(load)}>
                <Radio size={15} />
                采集并校验
              </button>
            </div>

            <div className="stat-grid">
              {Object.entries(stats.byScheme).map(([k, v]) => (
                <Stat key={k} label={`协议 ${k}`} icon={<Globe size={13} />} value={v} />
              ))}
            </div>
          </>
        )}

        {page === 'gateway' && gw && (
          <>
            <div className="stat-grid">
              <Stat
                label="监听端口"
                icon={<Plug size={13} />}
                value={gw.running ? `:${gw.port}` : '未运行'}
                tone={gw.running ? 'accent' : undefined}
                sub={gw.running ? '仅监听 127.0.0.1' : '端口可能被占用'}
              />
              <Stat
                label="已转发请求"
                icon={<Activity size={13} />}
                value={gw.requests}
                sub={gw.failed ? `失败 ${gw.failed}` : '无失败'}
                tone="good"
              />
              <Stat
                label="当前节点"
                icon={<Globe size={13} />}
                value={
                  <span style={{ fontSize: 15 }}>{gw.active?.split('//')[1] ?? '—'}</span>
                }
                sub={gw.active?.split('://')[0] ?? '尚未使用'}
              />
            </div>

            <div className="card toolbar">
              <code className="addr">export https_proxy=http://127.0.0.1:{gw.port}</code>
              <span className="grow" />
              <button
                className="btn"
                onClick={() => copy(`export https_proxy=http://127.0.0.1:${gw.port}`)}
              >
                {copied.startsWith('export') ? <Check size={15} /> : <Copy size={15} />}
                复制
              </button>
            </div>

            <div className="card toolbar">
              <div className="chips">
                {STRATEGIES.map((s) => (
                  <button
                    key={s.id}
                    title={s.hint}
                    className={`chip${gw.strategy === s.id ? ' active' : ''}`}
                    onClick={() => setStrategy(s.id).then(load)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <span className="grow" />
              <span className="muted">迟滞 {gw.tolerance}ms</span>
            </div>

            <Notice>
              <strong>免费代理出口不可信</strong>
              <br />
              流量经由陌生的第三方服务器,可能被中间人窥探或篡改。请只用于抓取公开数据,
              不要走登录态、支付或任何敏感请求。
            </Notice>

            <div className="card">
              {gw.traffic.length === 0 ? (
                <Empty
                  icon={<Plug size={34} />}
                  title="暂无请求"
                  hint={`把流量指向 127.0.0.1:${gw.port} 后,这里会显示实时请求`}
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>目标</th>
                        <th>经由</th>
                        <th>耗时</th>
                        <th>结果</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gw.traffic.map((t, i) => (
                        <tr key={`${t.at}-${i}`}>
                          <td className="mono muted">
                            {new Date(t.at).toLocaleTimeString('zh-CN', { hour12: false })}
                          </td>
                          <td className="addr">{t.target}</td>
                          <td className="mono muted">{t.via?.split('//')[1] ?? '—'}</td>
                          <td className="mono">{t.ms}ms</td>
                          <td>
                            <span className={`badge ${t.ok ? 'badge-yes' : 'badge-no'}`}>
                              {t.ok ? '成功' : '失败'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {page === 'pool' && (
          <>
            <div className="card toolbar">
              <div className="chips">
                {['', 'socks5', 'socks4', 'http'].map((s) => (
                  <button
                    key={s || 'all'}
                    className={`chip${scheme === s ? ' active' : ''}`}
                    onClick={() => setScheme(s)}
                  >
                    {s || '全部协议'}
                  </button>
                ))}
                <button
                  className={`chip${onlyHttps ? ' active' : ''}`}
                  onClick={() => setOnlyHttps((v) => !v)}
                >
                  <Lock size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                  仅 HTTPS 可用
                </button>
              </div>
              <span className="grow" />
              <span className="muted">{proxies.length} 条</span>
            </div>

            <div className="card">
              {proxies.length === 0 ? (
                <Empty
                  icon={<Boxes size={34} />}
                  title="暂无可用代理"
                  hint={offline ? '后端未连接' : '池子是空的,先跑一次采集与校验'}
                  action={
                    <button
                      className="btn btn-primary"
                      disabled={busy || offline}
                      onClick={() => refresh(true).then(load)}
                    >
                      <Radio size={16} />
                      立即采集
                    </button>
                  }
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>地址</th>
                        <th>协议</th>
                        <th>评分</th>
                        <th>延迟</th>
                        <th>HTTPS</th>
                        <th>匿名度</th>
                        <th>国家</th>
                        <th>来源</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {proxies.map((p) => (
                        <tr key={p.addr}>
                          <td className="addr">{p.addr}</td>
                          <td>
                            <SchemeBadge scheme={p.scheme} />
                          </td>
                          <td>
                            <Score value={p.score} />
                          </td>
                          <td className="mono">{p.latencyMs ? `${p.latencyMs}ms` : '—'}</td>
                          <td>
                            <span className={`badge ${p.https ? 'badge-yes' : 'badge-no'}`}>
                              {p.https ? '可用' : '不可'}
                            </span>
                          </td>
                          <td className="muted">{p.anonymity ?? '—'}</td>
                          <td className="mono">{p.country ?? '—'}</td>
                          <td className="muted">{p.source ?? '—'}</td>
                          <td>
                            <button
                              className="btn btn-icon"
                              title="复制代理地址"
                              onClick={() => copy(p.url)}
                            >
                              {copied === p.url ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                            <button
                              className="btn btn-icon"
                              title="删除"
                              onClick={() => drop(p.addr)}
                              style={{ marginLeft: 6 }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}

        {page === 'sources' && stats && (
          <div className="card">
            {stats.bySource.map((s) => {
              const rate = s.total ? (s.live / s.total) * 100 : 0;
              return (
                <div className="source-row" key={s.source}>
                  <span className="source-name">{s.source}</span>
                  <div className="source-meter">
                    <div className="source-meter-fill" style={{ width: `${Math.min(rate * 4, 100)}%` }} />
                  </div>
                  <span className="mono muted">
                    {s.live} / {s.total.toLocaleString()} ({rate.toFixed(1)}%)
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {page === 'log' && (
          <div className="card">
            {lines.length === 0 ? (
              <Empty icon={<ScrollText size={34} />} title="暂无日志" hint="运行一次采集或校验后这里会有输出" />
            ) : (
              <div className="log-view">{lines.join('\n')}</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
