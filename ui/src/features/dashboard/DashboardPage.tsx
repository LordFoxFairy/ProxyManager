import { Activity, Database, Download, Globe, Lock, Plug, RefreshCw, Zap } from 'lucide-react';
import { ActionGuard } from '../../components/ActionGuard';
import { Stat, fmtAge } from '../../components/Pieces';
import type { Gateway, Stats } from '../../lib/api';
import type { Page, RunKind } from '../../app/types';

export function DashboardPage({
  stats,
  gateway,
  validationActive,
  validationStageLabel,
  validationPercent,
  collectionActive,
  fullCollectionActive,
  onRun,
  onLocked,
  onNavigate,
}: {
  stats: Stats;
  gateway: Gateway | null;
  validationActive: boolean;
  validationStageLabel: string;
  validationPercent: number;
  collectionActive: boolean;
  fullCollectionActive: boolean;
  onRun: (kind: RunKind) => Promise<void>;
  onLocked: (title: string, detail: string) => void;
  onNavigate: (page: Page) => void;
}) {
  return (
    <>
      <div className="stat-grid">
        <Stat
          label="当前出口 IP"
          icon={<Globe size={13} />}
          value={<span className="stat-ip">{gateway?.currentProxy?.exitIp ?? '—'}</span>}
          tone={gateway?.currentProxy?.exitIp ? 'good' : undefined}
          sub={gateway?.currentProxy
            ? `${gateway.currentProxy.active ? '使用中' : '最优候选'} · ${gateway.currentProxy.upstream.split('://')[1]}`
            : '等待可用节点'}
        />
        <Stat label="可用代理" icon={<Activity size={13} />} value={stats.live} tone="accent" sub={`共采集 ${stats.total.toLocaleString()} 个候选`} />
        <Stat
          label="支持 HTTPS"
          icon={<Lock size={13} />}
          value={stats.liveHttps}
          tone="good"
          sub={stats.live ? `占可用的 ${Math.round((stats.liveHttps / stats.live) * 100)}%` : '—'}
        />
        <Stat label="平均延迟" icon={<Zap size={13} />} value={stats.avgLatency ? `${stats.avgLatency}ms` : '—'} tone="warn" />
        <Stat
          label="待校验"
          icon={<Database size={13} />}
          value={stats.unchecked.toLocaleString()}
          sub={validationActive
            ? `${validationStageLabel} ${validationPercent}%`
            : stats.lastRun
              ? `上次 ${fmtAge(stats.lastRun)}`
              : '尚未运行'}
        />
      </div>

      <div className="card toolbar">
        <span className="muted">
          健康检查:{validationActive ? validationStageLabel : '空闲'} · 来源:{collectionActive ? '更新中' : '空闲'}
        </span>
        <span className="grow" />
        <ActionGuard
          locked={validationActive}
          reason="健康检查已在运行"
          onLocked={() => onLocked('健康检查正在运行', '当前进度会持续更新，来源更新和其他页面仍可正常操作。')}
        >
          <button className="btn" onClick={() => void onRun('validate')}>
            {validationActive ? <RefreshCw size={15} className="spin" /> : <Activity size={15} />}
            {validationActive ? '检查中' : '健康检查'}
          </button>
        </ActionGuard>
        <ActionGuard
          locked={fullCollectionActive}
          reason="全量来源更新已在运行"
          onLocked={() => onLocked('来源正在更新', '健康检查与代理池使用不会被来源更新阻塞。')}
        >
          <button className="btn btn-primary" onClick={() => void onRun('collect')}>
            {fullCollectionActive ? <RefreshCw size={15} className="spin" /> : <Download size={15} />}
            {fullCollectionActive ? '更新中' : '更新来源'}
          </button>
        </ActionGuard>
      </div>

      <div className="stat-grid">
        {Object.entries(stats.byScheme).map(([scheme, count]) => (
          <Stat key={scheme} label={`协议 ${scheme}`} icon={<Globe size={13} />} value={count} />
        ))}
      </div>

      {gateway?.running && (
        <div className="card toolbar" style={{ marginTop: 20 }}>
          <Plug size={16} className="muted" />
          <span>
            本地代理运行中 · <code className="addr">http://127.0.0.1:{gateway.port}</code> · 已转发 {gateway.requests} 个请求
          </span>
          <span className="grow" />
          <button className="btn" onClick={() => onNavigate('routing')}>查看路由</button>
        </div>
      )}
    </>
  );
}
