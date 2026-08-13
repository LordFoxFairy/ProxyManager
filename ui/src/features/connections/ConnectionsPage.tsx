import { useEffect, useState } from 'react';
import { Activity, CircleCheck, CircleX, ExternalLink, Waypoints } from 'lucide-react';
import { Empty, Stat } from '../../components/Pieces';
import { gatewayConnectionsStreamUrl, type Gateway } from '../../lib/api';

export function ConnectionsPage({ gateway }: { gateway: Gateway }) {
  const [streamTraffic, setStreamTraffic] = useState<Gateway['traffic'] | null>(null);
  useEffect(() => {
    const source = new EventSource(gatewayConnectionsStreamUrl());
    source.addEventListener('connections', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as { source?: string; items?: Array<{ start?: string; metadata?: { host?: string; destinationIP?: string; process?: string }; chains?: string[]; rule?: string; upload?: number; download?: number }> };
        if (payload.source !== 'mihomo' || !Array.isArray(payload.items)) return;
        setStreamTraffic(payload.items.map((item) => ({ at: item.start ? Date.parse(item.start) || Date.now() : Date.now(), target: item.metadata?.host ?? item.metadata?.destinationIP ?? '—', via: item.chains?.[0] ?? null, ms: 0, ok: true, source: 'mihomo' as const, process: item.metadata?.process ?? null, rule: item.rule ?? null, upload: item.upload ?? 0, download: item.download ?? 0 })));
      } catch { /* malformed stream events are ignored */ }
    });
    return () => source.close();
  }, []);
  const traffic = streamTraffic ?? gateway.traffic;
  const successful = traffic.filter((item) => item.ok).length;
  const average = traffic.length
    ? Math.round(traffic.reduce((sum, item) => sum + item.ms, 0) / traffic.length)
    : null;
  return (
    <>
      <div className="stat-grid connection-stats">
        <Stat label="当前连接记录" icon={<Waypoints size={13} />} value={traffic.length} sub="实时流" />
        <Stat label="成功请求" icon={<CircleCheck size={13} />} value={successful} tone="good" />
        <Stat label="失败请求" icon={<CircleX size={13} />} value={traffic.length - successful} />
        <Stat label="平均耗时" icon={<Activity size={13} />} value={average == null ? '—' : `${average}ms`} tone="warn" />
      </div>

      <section className="work-panel connections-panel">
        <div className="work-panel-head">
          <div><strong>实时连接</strong><span>请求、命中用途与实际出口</span></div>
          <span className="runtime-pill">{streamTraffic ? 'Mihomo SSE' : gateway.traffic.some((item) => item.source === 'mihomo') ? 'Mihomo API' : '内置网关记录'}</span>
          <span className={`runtime-pill${gateway.running ? ' online' : ''}`}>{gateway.running ? '网关运行中' : '网关未运行'}</span>
        </div>
        {traffic.length === 0 ? (
          <Empty icon={<Waypoints size={34} />} title="暂无连接" hint={`把应用流量指向 127.0.0.1:${gateway.port} 后，这里会显示实际链路`} />
        ) : (
          <div className="table-wrap connection-table-wrap">
            <table>
              <thead><tr><th>时间</th><th>目标</th><th>实际节点</th><th>规则</th><th>流量</th><th>结果</th><th /></tr></thead>
              <tbody>
                {traffic.map((item, index) => (
                  <tr key={`${item.at}-${index}`}>
                    <td className="mono muted">{new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })}</td>
                    <td className="addr">{item.target}</td>
                    <td className="mono muted">{item.via?.split('//')[1] ?? '—'}</td>
                    <td className="mono muted">{item.rule ?? '—'}</td>
                    <td className="mono">{item.download || item.upload ? `${Math.round((item.download ?? 0) / 1024)}K↓ ${Math.round((item.upload ?? 0) / 1024)}K↑` : `${item.ms}ms`}</td>
                    <td><span className={`badge ${item.ok ? 'badge-yes' : 'badge-no'}`}>{item.ok ? '成功' : '失败'}</span></td>
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
