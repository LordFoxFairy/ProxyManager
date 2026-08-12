import { Activity, Check, Copy, Globe, Network, Plug, Radar } from 'lucide-react';
import { Stat } from '../../components/Pieces';
import { SelectMenu, type SelectOption } from '../../components/SelectMenu';
import { setStrategy, type Gateway, type Strategy } from '../../lib/api';

const STRATEGIES: { id: Strategy; label: string; hint: string }[] = [
  { id: 'url-test', label: '最优节点', hint: '选择低延迟节点，并以迟滞值抑制频繁切换' },
  { id: 'round-robin', label: '依次轮换', hint: '按请求轮换，分散单一出口负载' },
  { id: 'random', label: '随机', hint: '每次从符合策略的节点中随机选择' },
];

export function GatewayPage({
  gateway,
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
