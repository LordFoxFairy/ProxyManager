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
import { getLog, getProxies, getStats, refresh, removeProxy, type Proxy, type Stats } from './lib/api';
import './styles/base.css';
import './styles/app.css';

type Page = 'dashboard' | 'pool' | 'sources' | 'log';

const NAV: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: '仪表盘', icon: Gauge },
  { id: 'pool', label: '代理池', icon: Boxes },
  { id: 'sources', label: '采集源', icon: Layers },
  { id: 'log', label: '运行日志', icon: ScrollText },
];

export default function App() {
  const [page, setPage] = useState<Page>('dashboard');
  const [stats, setStats] = useState<Stats | null>(null);
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [onlyHttps, setOnlyHttps] = useState(false);
  const [scheme, setScheme] = useState<string>('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p, l] = await Promise.all([
        getStats(),
        getProxies({ n: 200, https: onlyHttps, scheme: scheme || undefined }),
        getLog(),
      ]);
      setStats(s);
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
    setTimeout(() => setCopied((c) => (c === url ? null : c)), 1200);
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
            <strong>无法连接后端服务。</strong>
            <br />
            请先启动:<code> cd server &amp;&amp; npm run dev serve</code>
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
