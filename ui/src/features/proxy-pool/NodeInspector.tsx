import { Activity, ArrowRight, Copy, Globe2, Network, RefreshCw, Shield, X } from 'lucide-react';
import { ActionGuard } from '../../components/ActionGuard';
import { SchemeBadge, fmtAge } from '../../components/Pieces';
import type { ConnectivityResult, ConnectivityTarget, Proxy } from '../../lib/api';

export function NodeInspector({ proxy, targets, results, loading, checkedAt, error, onClose, onRun, onDiagnostics, onCopy, onLocked }: { proxy: Proxy; targets: ConnectivityTarget[]; results: Record<string, ConnectivityResult>; loading: boolean; checkedAt: number | null; error: string; onClose: () => void; onRun: () => Promise<void>; onDiagnostics: () => void; onCopy: () => void; onLocked: () => void }) {
  const available = Object.values(results).filter((item) => item.available).length;
  const total = Object.keys(results).length;
  return (
    <aside className="node-inspector" aria-label="节点详情">
      <header className="inspector-head"><div><span>节点详情</span><strong>{proxy.addr}</strong></div><button className="btn btn-icon" title="关闭节点详情" onClick={onClose}><X size={15} /></button></header>
      <div className="inspector-actions"><button className="btn" onClick={onCopy}><Copy size={14} />复制</button><ActionGuard locked={!proxy.https} reason="该节点不支持 HTTPS 目标检测" onLocked={onLocked}><button className="btn" disabled={loading} onClick={() => void onRun()}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? '检测中' : '检测服务'}</button></ActionGuard></div>
      <section className="inspector-summary">
        <div><span><Globe2 size={14} />出口</span><strong>{proxy.exitIp ?? '—'}</strong><small>{proxy.country ?? '未知地区'}</small></div>
        <div><span><Activity size={14} />延迟</span><strong>{proxy.latencyMs == null ? '—' : `${proxy.latencyMs}ms`}</strong><small>评分 {proxy.score}</small></div>
      </section>
      <dl className="inspector-facts"><div><dt>协议</dt><dd><SchemeBadge scheme={proxy.scheme} /></dd></div><div><dt>HTTPS</dt><dd>{proxy.https ? '可用' : '不可用'}</dd></div><div><dt>匿名度</dt><dd>{proxy.anonymity ?? '—'}</dd></div><div><dt>Provider</dt><dd title={proxy.source ?? undefined}>{proxy.source ?? '—'}</dd></div><div><dt>基础健康</dt><dd>{proxy.checkedAt ? `检查于 ${fmtAge(proxy.checkedAt)}` : '未检查'}</dd></div></dl>
      <section className="inspector-capabilities">
        <header><div><strong>服务能力</strong><span>{checkedAt ? `${available}/${total} · ${fmtAge(checkedAt)}` : '尚未检测'}</span></div><Shield size={15} /></header>
        {error && <div className="inspector-error">{error}</div>}
        <div className="capability-list">{targets.slice(0, 6).map((target) => { const result = results[target.id]; return <div key={target.id}><span className={`capability-dot${loading ? ' checking' : result?.available ? ' good' : result ? 'bad' : ''}`} /><strong>{target.name}</strong><span>{loading ? '检测中' : result?.available ? `${result.latencyMs ?? '—'}ms` : result ? '不可用' : '未检测'}</span></div>; })}</div>
      </section>
      <button className="inspector-diagnostics" onClick={onDiagnostics}><Network size={15} /><span><strong>打开完整诊断</strong><small>查看服务能力、IP 画像与环境证据</small></span><ArrowRight size={15} /></button>
    </aside>
  );
}
