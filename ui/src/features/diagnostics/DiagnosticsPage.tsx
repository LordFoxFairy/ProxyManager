import {
  Activity,
  CheckCircle2,
  CircleDot,
  Clock3,
  Code2,
  ExternalLink,
  Globe2,
  Network,
  RefreshCw,
  ScanSearch,
  ShieldCheck,
  Wifi,
} from 'lucide-react';
import { useState, type ComponentType, type CSSProperties } from 'react';
import { fmtAge } from '../../components/Pieces';
import type { BrowserDiagnosticSession, ConnectivityResult, ConnectivityTarget, Gateway, IpProfile, Proxy, Stats } from '../../lib/api';

type Suite = 'quick' | 'services' | 'profile' | 'leaks';

export function DiagnosticsPage({
  stats,
  gateway,
  gatewayProxy,
  mode,
  proxy,
  targets,
  results,
  checkedAt,
  loading,
  error,
  onModeChange,
  onRunGateway,
  onRunProxy,
  browserSession,
  browserDiagnosticLoading,
  browserDiagnosticError,
  onOpenBrowser,
  ipProfile,
}: {
  stats: Stats;
  gateway: Gateway | null;
  gatewayProxy: Proxy | null;
  mode: 'gateway' | 'proxy';
  proxy: Proxy | null;
  targets: ConnectivityTarget[];
  results: Record<string, ConnectivityResult>;
  checkedAt: number | null;
  loading: boolean;
  error: string;
  onModeChange: (mode: 'gateway' | 'proxy') => void;
  onRunGateway: () => Promise<void>;
  onRunProxy: (proxy: Proxy) => Promise<void>;
  browserSession: BrowserDiagnosticSession | null;
  browserDiagnosticLoading: boolean;
  browserDiagnosticError: string;
  onOpenBrowser: () => Promise<void>;
  ipProfile: IpProfile | null;
}) {
  const [suite, setSuite] = useState<Suite>('quick');
  const activeProxy = mode === 'proxy' ? proxy : gatewayProxy;
  const exitIp = activeProxy?.exitIp ?? gateway?.currentProxy?.exitIp ?? null;
  const country = activeProxy?.country ?? gateway?.currentProxy?.country ?? null;
  const latency = activeProxy?.latencyMs ?? gateway?.currentProxy?.latencyMs ?? null;
  const resultList = targets
    .map((target) => results[target.id])
    .filter((result): result is ConnectivityResult => Boolean(result));
  const available = resultList.filter((item) => item.available).length;
  const serviceScore = resultList.length ? Math.round((available / resultList.length) * 100) : null;
  const healthState = activeProxy
    ? activeProxy.checkedAt
      ? activeProxy.score > 0 ? '基础健康可用' : '基础健康异常'
      : '基础健康未检测'
    : gateway?.currentProxy
      ? '基础健康可用'
      : '无可用节点';
  const healthTone = stats.jobs.validation.running
    ? 'warn'
    : activeProxy?.checkedAt && activeProxy.score <= 0 || !activeProxy && !gateway?.currentProxy
      ? 'warn'
      : healthState === '基础健康未检测' ? 'pending' : 'good';
  const rerun = () => mode === 'proxy' && proxy ? onRunProxy(proxy) : onRunGateway();

  return (
    <div className="diagnostics-page">
      <section className="diagnostic-toolbar">
        <div className="diagnostic-object">
          <span>检测对象</span>
          <div className="segmented-control">
            <button className={mode === 'gateway' ? 'active' : ''} onClick={() => onModeChange('gateway')}>当前网关出口</button>
            <button className={mode === 'proxy' ? 'active' : ''} disabled={!proxy} onClick={() => onModeChange('proxy')}>指定节点</button>
          </div>
        </div>
        <div className="diagnostic-current">
          <span className="diagnostic-current-icon"><Globe2 size={18} /></span>
          <div><span>{mode === 'gateway' ? '网关出口' : '指定节点'}</span><strong>{exitIp ?? '等待可用出口'}</strong></div>
          <span>{country ?? '未知地区'} · {latency ?? '—'}ms</span>
        </div>
        <button className="btn btn-primary" disabled={loading || (!gateway && !proxy)} onClick={() => void rerun()}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? '检测中' : '重新检测'}
        </button>
      </section>

      <div className="diagnostic-tabs" role="tablist">
        <DiagnosticTab id="quick" label="快速体检" icon={ScanSearch} active={suite === 'quick'} onClick={setSuite} />
        <DiagnosticTab id="services" label="服务能力" icon={Activity} active={suite === 'services'} onClick={setSuite} />
        <DiagnosticTab id="profile" label="IP 画像" icon={Network} active={suite === 'profile'} onClick={setSuite} />
        <DiagnosticTab id="leaks" label="泄漏与环境" icon={ShieldCheck} active={suite === 'leaks'} onClick={setSuite} />
      </div>

      {error && <div className="diagnostic-error">{error}</div>}

      {suite === 'quick' && (
        <div className="diagnostic-layout">
          <section className="diagnostic-score-panel">
            <div
              className={`diagnostic-score-ring${serviceScore === null ? ' pending' : ''}`}
              style={{ '--diagnostic-score': `${serviceScore ?? 0}%` } as CSSProperties}
            ><strong>{serviceScore === null ? '—' : `${serviceScore}%`}</strong><span>服务能力</span></div>
            <div><strong>{resultList.length ? `${available} / ${resultList.length} 个目标可用` : '等待检测'}</strong><span>{checkedAt ? `最近 ${fmtAge(checkedAt)}` : '运行检测后生成证据'}</span></div>
          </section>
          <section className="diagnostic-findings">
            <Finding icon={Network} label="基础链路" value={exitIp ? '出口已确认' : '等待出口'} tone={exitIp ? 'good' : 'pending'} detail={activeProxy ? `${activeProxy.scheme} · 评分 ${activeProxy.score}` : gateway?.currentProxy?.upstream ?? '无可用节点'} />
            <Finding icon={Activity} label="服务能力" value={resultList.length ? `${available}/${resultList.length} 可用` : '未检测'} tone={available === resultList.length && resultList.length ? 'good' : resultList.length ? 'warn' : 'pending'} detail="OpenAI、Claude、GitHub 等目标独立判断" />
            <Finding icon={Globe2} label="出口地区" value={country ?? '未知'} tone={country ? 'good' : 'pending'} detail={`出口 IP ${exitIp ?? '—'}`} />
            <Finding icon={Clock3} label="健康状态" value={stats.jobs.validation.running ? '检查中' : healthState} tone={healthTone} detail={`池内 ${stats.live} 个可用节点`} />
          </section>
        </div>
      )}

      {suite === 'services' && <ServiceCapabilityTable targets={targets} results={results} loading={loading} checkedAt={checkedAt} />}

      {suite === 'profile' && (
        <section className="diagnostic-module-grid">
          <DiagnosticModule title="出口身份" status={exitIp ? '已获取' : '待检测'} icon={Globe2} rows={[
            ['出口 IP', exitIp ?? '—'], ['国家 / 地区', country ?? '—'], ['协议', activeProxy?.scheme ?? gateway?.currentProxy?.upstream.split('://')[0] ?? '—'], ['延迟', latency == null ? '—' : `${latency}ms`],
          ]} />
          <DiagnosticModule title="网络画像" status={ipProfile ? '已获取' : '等待出口画像'} icon={Network} rows={[
            ['ASN / 运营商', ipProfile?.asn ?? '待获取'], ['组织 / ISP', ipProfile?.org ?? ipProfile?.isp ?? '待获取'], ['住宅 / IDC / 移动', ipProfile?.mobile ? '移动网络' : ipProfile?.hosting ? '托管网络' : ipProfile ? '未标记' : '待获取'], ['代理标记', ipProfile?.proxy == null ? '待获取' : ipProfile.proxy ? '是' : '否'],
          ]} muted={!ipProfile} />
          <DiagnosticModule title="风险情报" status="待接入数据源" icon={ShieldCheck} rows={[
            ['公开代理记录', '待接入'], ['黑名单记录', '待接入'], ['风险等级', '待接入'], ['数据证据', '暂无'],
          ]} muted />
        </section>
      )}

      {suite === 'leaks' && (
        <section className="diagnostic-module-grid">
          <DiagnosticModule title="IPv4 / IPv6 出口" status={browserSession?.state === 'complete' ? '浏览器证据已回传' : '需打开默认浏览器'} icon={Globe2} rows={[["HTTP IPv4", browserSession?.evidence?.ipv4 ?? exitIp ?? '—'], ['HTTP IPv6', browserSession?.evidence?.ipv6 ?? '待检测'], ['国家一致性', browserSession?.evidence?.ipv4 && exitIp ? browserSession.evidence.ipv4 === exitIp ? '与网关出口一致' : '存在差异' : '待检测']]} muted={!browserSession?.evidence} />
          <DiagnosticModule title="DNS 泄漏" status="需配置唯一域名探针" icon={Wifi} rows={[["解析器", '待配置回传服务'], ['解析器国家', '待配置回传服务'], ['与出口一致性', '待配置回传服务']]} muted />
          <DiagnosticModule title="WebRTC 泄漏" status={browserSession?.state === 'complete' ? '浏览器证据已回传' : '需打开默认浏览器'} icon={CircleDot} rows={[["公网候选", browserSession?.evidence?.webrtcPublic.join(', ') || '未发现'], ['本地候选', browserSession?.evidence?.webrtcPrivate.join(', ') || '未发现'], ['mDNS 主机名', browserSession?.evidence?.webrtcMdns ? '已发现' : '未发现']]} muted={!browserSession?.evidence} />
          <DiagnosticModule title="环境一致性" status={browserSession?.state === 'complete' ? '浏览器证据已回传' : '需打开默认浏览器'} icon={Code2} rows={[["时区", browserSession?.evidence?.timezone ?? '待检测'], ['语言', browserSession?.evidence?.languages.join(', ') || '待检测'], ['UA / 内核', browserSession?.evidence?.userAgent ?? '待检测']]} muted={!browserSession?.evidence} />
        </section>
      )}
      {suite === 'leaks' && <section className="browser-diagnostic-action"><div><strong>在默认浏览器采集环境证据</strong><span>浏览器才能观察 WebRTC、IPv6 和真实时区/语言环境</span></div><button className="btn btn-primary" disabled={browserDiagnosticLoading} onClick={() => void onOpenBrowser()}><ExternalLink size={15} />{browserDiagnosticLoading ? '准备中' : browserSession?.state === 'pending' ? '等待浏览器回传' : '打开浏览器诊断'}</button>{browserDiagnosticError && <small>{browserDiagnosticError}</small>}</section>}
    </div>
  );
}

function DiagnosticTab({ id, label, icon: Icon, active, onClick }: { id: Suite; label: string; icon: ComponentType<{ size?: number }>; active: boolean; onClick: (id: Suite) => void }) {
  return <button role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={() => onClick(id)}><Icon size={15} />{label}</button>;
}

function Finding({ icon: Icon, label, value, detail, tone }: { icon: ComponentType<{ size?: number }>; label: string; value: string; detail: string; tone: 'good' | 'warn' | 'pending' }) {
  return <article className={`diagnostic-finding ${tone}`}><span><Icon size={16} /></span><div><strong>{label}</strong><small>{detail}</small></div><b>{value}</b></article>;
}

function ServiceCapabilityTable({ targets, results, loading, checkedAt }: { targets: ConnectivityTarget[]; results: Record<string, ConnectivityResult>; loading: boolean; checkedAt: number | null }) {
  return (
    <section className="work-panel service-capability-panel">
      <div className="work-panel-head"><div><strong>服务能力</strong><span>站点失败不会改变节点基础健康</span></div><span>{checkedAt ? fmtAge(checkedAt) : '未检测'}</span></div>
      <table className="diagnostic-table"><thead><tr><th>目标</th><th>状态</th><th>延迟</th><th>HTTP</th><th>失败类型</th></tr></thead><tbody>
        {targets.map((target) => {
          const result = results[target.id];
          return <tr key={target.id}><td><strong>{target.name}</strong><span>{new URL(target.url).hostname}</span></td><td><span className={`diagnostic-status ${loading ? 'checking' : result?.available ? 'good' : result ? 'bad' : 'pending'}`}>{loading ? '检测中' : result?.available ? '可用' : result ? '不可用' : '未检测'}</span></td><td className="mono">{result?.latencyMs == null ? '—' : `${result.latencyMs}ms`}</td><td className="mono">{result?.statusCode ?? '—'}</td><td>{result?.error === 'timeout' ? '超时' : result?.error === 'unreachable' ? '连接失败' : result?.error === 'no-proxy' ? '无节点' : '—'}</td></tr>;
        })}
      </tbody></table>
    </section>
  );
}

function DiagnosticModule({ title, status, icon: Icon, rows, muted = false }: { title: string; status: string; icon: ComponentType<{ size?: number }>; rows: string[][]; muted?: boolean }) {
  return <article className={`diagnostic-module${muted ? ' muted-module' : ''}`}><header><span><Icon size={17} /></span><div><strong>{title}</strong><small>{status}</small></div>{!muted && <CheckCircle2 size={16} />}</header><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>;
}
