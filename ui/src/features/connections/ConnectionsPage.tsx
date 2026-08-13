import { Activity, CircleCheck, CircleX, ExternalLink, Waypoints } from 'lucide-react';
import { Empty, Stat } from '../../components/Pieces';
import type { Gateway } from '../../lib/api';

export function ConnectionsPage({ gateway }: { gateway: Gateway }) {
  const successful = gateway.traffic.filter((item) => item.ok).length;
  const average = gateway.traffic.length
    ? Math.round(gateway.traffic.reduce((sum, item) => sum + item.ms, 0) / gateway.traffic.length)
    : null;
  return (
    <>
      <div className="stat-grid connection-stats">
        <Stat label="当前连接记录" icon={<Waypoints size={13} />} value={gateway.traffic.length} sub="最近 30 条" />
        <Stat label="成功请求" icon={<CircleCheck size={13} />} value={successful} tone="good" />
        <Stat label="失败请求" icon={<CircleX size={13} />} value={gateway.traffic.length - successful} />
        <Stat label="平均耗时" icon={<Activity size={13} />} value={average == null ? '—' : `${average}ms`} tone="warn" />
      </div>

      <section className="work-panel connections-panel">
        <div className="work-panel-head">
          <div><strong>实时连接</strong><span>请求、命中用途与实际出口</span></div>
          <span className="runtime-pill">{gateway.traffic.some((item) => item.source === 'mihomo') ? 'Mihomo API' : '内置网关记录'}</span>
          <span className={`runtime-pill${gateway.running ? ' online' : ''}`}>{gateway.running ? '网关运行中' : '网关未运行'}</span>
        </div>
        {gateway.traffic.length === 0 ? (
          <Empty icon={<Waypoints size={34} />} title="暂无连接" hint={`把应用流量指向 127.0.0.1:${gateway.port} 后，这里会显示实际链路`} />
        ) : (
          <div className="table-wrap connection-table-wrap">
            <table>
              <thead><tr><th>时间</th><th>目标</th><th>实际节点</th><th>规则</th><th>流量</th><th>结果</th><th /></tr></thead>
              <tbody>
                {gateway.traffic.map((traffic, index) => (
                  <tr key={`${traffic.at}-${index}`}>
                    <td className="mono muted">{new Date(traffic.at).toLocaleTimeString('zh-CN', { hour12: false })}</td>
                    <td className="addr">{traffic.target}</td>
                    <td className="mono muted">{traffic.via?.split('//')[1] ?? '—'}</td>
                    <td className="mono muted">{traffic.rule ?? '—'}</td>
                    <td className="mono">{traffic.download || traffic.upload ? `${Math.round((traffic.download ?? 0) / 1024)}K↓ ${Math.round((traffic.upload ?? 0) / 1024)}K↑` : `${traffic.ms}ms`}</td>
                    <td><span className={`badge ${traffic.ok ? 'badge-yes' : 'badge-no'}`}>{traffic.ok ? '成功' : '失败'}</span></td>
                    <td><ExternalLink size={13} className="muted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
