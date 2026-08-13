import { Activity, Check, Copy, Globe, Network, Plug, Radar } from 'lucide-react';
import { Stat } from '../../components/Pieces';
import { SelectMenu, type SelectOption } from '../../components/SelectMenu';
import { setStrategy, type DesktopUpdate, type Gateway, type RuntimeConfig, type RuntimeStatus, type Strategy } from '../../lib/api';

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: 'url-test', label: '最优节点', hint: '选择低延迟节点，并以迟滞值抑制频繁切换' },
  { id: 'round-robin', label: '依次轮换', hint: '按请求轮换，分散单一出口负载' },
  { id: 'random', label: '随机', hint: '每次从符合策略的节点中随机选择' },
];

export function GatewayPage({
  gateway,
  runtimeStatus,
  runtimeConfig,
  systemProxyActual,
  onSaveRuntime,
  onRuntimeAction,
  onRollbackRuntime,
  onExportConfig,
  onImportConfig,
  desktopUpdate,
  desktopUpdateBusy,
  onCheckDesktopUpdate,
  onInstallDesktopUpdate,
  copied,
  routingSaving,
  routingError,
  profileOptions,
  countryOptions,
  onCopy,
  onSaveRouting,
  onReload,
}: {
  gateway: Gateway;
  runtimeStatus: RuntimeStatus;
  runtimeConfig: RuntimeConfig;
  systemProxyActual: boolean | null;
  onSaveRuntime: (patch: Partial<RuntimeConfig> & { kind?: 'builtin' | 'mihomo' }) => Promise<void>;
  onRuntimeAction: (action: 'start' | 'stop' | 'restart') => Promise<void>;
  onRollbackRuntime: () => Promise<void>;
  onExportConfig: () => Promise<void>;
  onImportConfig: (file: File) => Promise<void>;
  desktopUpdate: DesktopUpdate | null;
  desktopUpdateBusy: boolean;
  onCheckDesktopUpdate: () => Promise<void>;
  onInstallDesktopUpdate: () => Promise<void>;
  copied: string;
  routingSaving: boolean;
  routingError: string;
  profileOptions: SelectOption[];
  countryOptions: SelectOption[];
  onCopy: (value: string) => void;
  onSaveRouting: (patch: { profile?: string; country?: string | null }) => Promise<void>;
  onReload: () => Promise<void>;
}) {
  const envCommand = `export https_proxy=http://127.0.0.1:${gateway.port}`;
  const toggleRuntime = (key: 'systemProxy' | 'tun' | 'dns') => void onSaveRuntime({ [key]: !runtimeConfig[key] });
  return (
    <>
      <div className="stat-grid">
        <Stat label="监听端口" icon={<Plug size={13} />} value={gateway.running ? `:${gateway.port}` : '未运行'} tone={gateway.running ? 'accent' : undefined} sub={gateway.running ? '仅监听 127.0.0.1' : '端口可能被占用'} />
        <Stat label="已转发请求" icon={<Activity size={13} />} value={gateway.requests} sub={gateway.failed ? `失败 ${gateway.failed}` : '无失败'} tone="good" />
        <Stat
          label="当前节点"
          icon={<Globe size={13} />}
          value={<span className="stat-ip">{gateway.currentProxy?.upstream.split('://')[1] ?? '—'}</span>}
          sub={gateway.currentProxy ? `${gateway.currentProxy.upstream.split('://')[0]} · ${gateway.currentProxy.active ? '使用中' : '最优候选'}` : '暂无可用节点'}
        />
        <Stat
          label="当前出口 IP"
          icon={<Network size={13} />}
          value={<span className="stat-ip">{gateway.currentProxy?.exitIp ?? '—'}</span>}
          tone={gateway.currentProxy?.exitIp ? 'good' : undefined}
          sub={gateway.currentProxy ? `${gateway.currentProxy.country ?? '未知地区'} · ${gateway.currentProxy.latencyMs ?? '—'}ms` : '等待代理校验'}
        />
      </div>

      <div className="card toolbar">
        <code className="addr">{envCommand}</code>
        <span className="grow" />
        <button className="btn" onClick={() => onCopy(envCommand)}>
          {copied.startsWith('export') ? <Check size={15} /> : <Copy size={15} />}复制
        </button>
      </div>

      <section className="runtime-control-panel">
        <div className="runtime-control-head">
          <div><strong>运行时</strong><span>{runtimeStatus.kind === 'mihomo' ? 'Mihomo sidecar' : '内置代理池网关'} · 配置 v{runtimeStatus.configVersion}</span></div>
          <div className="runtime-control-actions"><span className={`runtime-pill${runtimeStatus.lifecycle === 'running' ? ' online' : ''}`}>{runtimeStatus.lifecycle === 'running' ? '运行中' : runtimeStatus.lifecycle === 'degraded' ? '能力不完整' : runtimeStatus.lifecycle}</span>{runtimeStatus.kind === 'mihomo' && <><button className="btn btn-icon" title="重启 Mihomo" onClick={() => void onRuntimeAction('restart')}>↻</button><button className="btn" onClick={() => void onRollbackRuntime()}>回滚配置</button></>}<button className="btn" onClick={() => void onExportConfig()}>导出配置</button><label className="btn">导入配置<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void onImportConfig(file); event.currentTarget.value = ''; }} /></label><button className="btn" disabled={desktopUpdateBusy} onClick={() => void onCheckDesktopUpdate()}>{desktopUpdateBusy ? '检查中…' : '检查更新'}</button>{desktopUpdate?.available && <button className="btn btn-primary" disabled={desktopUpdateBusy} onClick={() => void onInstallDesktopUpdate()}>安装 {desktopUpdate.version}</button>}</div>
        </div>
        <div className="runtime-control-grid">
          <label><span>运行时内核</span><select value={runtimeStatus.kind} onChange={(event) => void onSaveRuntime({ kind: event.target.value as 'builtin' | 'mihomo' })}><option value="builtin">内置网关</option><option value="mihomo">Mihomo</option></select></label>
          <label><span>工作模式</span><select value={runtimeConfig.mode} onChange={(event) => void onSaveRuntime({ mode: event.target.value as RuntimeConfig['mode'] })}><option value="rule">规则模式</option><option value="global">全局模式</option><option value="direct">直连模式</option></select></label>
          <button className={`runtime-toggle ${systemProxyActual ?? runtimeConfig.systemProxy ? 'active' : ''}`} disabled={!runtimeStatus.capabilities.systemProxy} onClick={() => toggleRuntime('systemProxy')}><strong>系统代理</strong><span>{runtimeStatus.systemProxy === 'unsupported' ? '需 Mihomo' : systemProxyActual == null ? '状态未知' : systemProxyActual ? '系统已开启' : '系统已关闭'}</span></button>
          <button className={`runtime-toggle ${runtimeStatus.features.tun === 'active' ? 'active' : ''}`} disabled={!runtimeStatus.capabilities.tun} onClick={() => toggleRuntime('tun')}><strong>TUN 模式</strong><span>{runtimeStatus.features.tun === 'active' ? '已接管' : runtimeStatus.platform.tunDevice === 'permission-required' ? '点击后检查系统权限' : runtimeStatus.features.tun === 'configured' ? '已配置，等待系统路由' : runtimeStatus.features.tun === 'failed' ? '启动失败' : runtimeStatus.tun === 'unsupported' ? '需 Mihomo + 系统权限' : '已关闭'}</span></button>
          <button className={`runtime-toggle ${runtimeStatus.features.dns === 'active' ? 'active' : ''}`} disabled={!runtimeStatus.capabilities.dns} onClick={() => toggleRuntime('dns')}><strong>DNS 接管</strong><span>{runtimeStatus.features.dns === 'active' ? `${runtimeConfig.dnsMode} · 监听正常` : runtimeStatus.features.dns === 'configured' ? `${runtimeConfig.dnsMode} · 检测中` : runtimeStatus.features.dns === 'failed' ? '监听失败' : runtimeStatus.dns === 'unsupported' ? '需 Mihomo' : '已关闭'}</span></button>
        </div>
        {runtimeStatus.capabilities.dns && <div className="runtime-dns-fields"><label><span>增强模式</span><select value={runtimeConfig.dnsMode} onChange={(event) => void onSaveRuntime({ dnsMode: event.target.value as RuntimeConfig['dnsMode'] })}><option value="fake-ip">Fake-IP</option><option value="redir-host">redir-host</option></select></label><label><span>监听地址</span><input value={runtimeConfig.dnsListen} onChange={(event) => void onSaveRuntime({ dnsListen: event.target.value })} /></label><label className="dns-wide"><span>上游 DNS（逗号分隔）</span><input value={runtimeConfig.dnsNameservers.join(', ')} onChange={(event) => void onSaveRuntime({ dnsNameservers: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label></div>}
        {runtimeStatus.capabilities.tun && <div className="runtime-dns-fields"><label><span>TUN 栈</span><select value={runtimeConfig.tunStack} onChange={(event) => void onSaveRuntime({ tunStack: event.target.value as RuntimeConfig['tunStack'] })}><option value="system">system</option><option value="gvisor">gvisor</option><option value="mixed">mixed</option></select></label><label><span>DNS 劫持</span><input value={runtimeConfig.tunDnsHijack.join(', ')} onChange={(event) => void onSaveRuntime({ tunDnsHijack: event.target.value.split(',').map((item) => item.trim()).filter(Boolean) })} /></label><label className="dns-wide"><span>路由选项</span><div className="runtime-inline-checks"><label><input type="checkbox" checked={runtimeConfig.tunAutoRoute} onChange={(event) => void onSaveRuntime({ tunAutoRoute: event.target.checked })} />自动路由</label><label><input type="checkbox" checked={runtimeConfig.tunAutoDetectInterface} onChange={(event) => void onSaveRuntime({ tunAutoDetectInterface: event.target.checked })} />自动识别网卡</label></div></label></div>}
        {runtimeStatus.lastError && <div className="runtime-control-error">{runtimeStatus.lastError}</div>}
        {runtimeStatus.logs.length > 0 && <details className="runtime-log-details"><summary>Mihomo 最近日志</summary><pre>{runtimeStatus.logs.join('\n')}</pre></details>}
        {runtimeStatus.kind === 'mihomo' && <div className="runtime-control-footer"><span>Sidecar 控制</span><span className="grow" /><button className="btn" disabled={runtimeStatus.lifecycle === 'running'} onClick={() => void onRuntimeAction('start')}>启动</button><button className="btn" disabled={runtimeStatus.lifecycle !== 'running'} onClick={() => void onRuntimeAction('stop')}>停止</button></div>}
      </section>

      <section className={`gateway-routing${routingSaving ? ' saving' : ''}`}>
        <div className="gateway-routing-title">
          <span className="gateway-routing-icon"><Radar size={17} /></span>
          <div><strong>用途路由</strong><span>先限定目标服务，再按地区与健康状态选取出口</span></div>
        </div>
        <div className="gateway-routing-field">
          <span>使用场景</span>
          <SelectMenu
            label="使用场景"
            value={gateway.routing.profile}
            options={profileOptions}
            onChange={(value) => { if (!routingSaving) void onSaveRouting({ profile: value }); }}
            className="gateway-profile-menu"
          />
        </div>
        <div className="gateway-routing-field">
          <span>出口地区</span>
          <SelectMenu
            label="出口地区"
            value={gateway.routing.country ?? ''}
            options={countryOptions}
            searchable
            searchPlaceholder="搜索国家代码"
            onChange={(value) => { if (!routingSaving) void onSaveRouting({ country: value || null }); }}
            className="gateway-country-menu"
          />
        </div>
        <div className="gateway-routing-stats">
          <span><strong>{gateway.routing.eligible}</strong> 个地区候选</span>
          {gateway.routing.verified != null && (
            <span className={gateway.routing.learning ? 'learning' : 'verified'}>
              <strong>{gateway.routing.verified}</strong> 个用途已验证
            </span>
          )}
        </div>
        {routingError && <div className="gateway-routing-error">{routingError}</div>}
      </section>

      <div className="card toolbar">
        <div className="chips">
          {STRATEGIES.map((strategy) => (
            <button
              key={strategy.id}
              title={strategy.hint}
              className={`chip${gateway.strategy === strategy.id ? ' active' : ''}`}
              onClick={() => void setStrategy(strategy.id).then(onReload)}
            >
              {strategy.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="muted">迟滞 {gateway.tolerance}ms</span>
      </div>

      <section className="work-panel route-runtime-summary">
        <div className="work-panel-head"><div><strong>当前运行链路</strong><span>连接明细已移至“连接”页面</span></div><span className={`runtime-pill${gateway.running ? ' online' : ''}`}>{gateway.running ? '运行中' : '未运行'}</span></div>
        <div className="route-chain"><span>本地应用</span><b>→</b><span>{gateway.routing.profile}</span><b>→</b><span>{gateway.currentProxy?.upstream.split('://')[1] ?? '等待节点'}</span><b>→</b><span>{gateway.currentProxy?.exitIp ?? '等待出口'}</span></div>
      </section>
    </>
  );
}
