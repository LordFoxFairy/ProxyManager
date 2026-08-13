import { Boxes, Layers, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import type { ResourceView } from '../../app/types';
import type { ProxyPoolPageProps } from '../proxy-pool/ProxyPoolPage';
import { ProxyPoolPage } from '../proxy-pool/ProxyPoolPage';
import type { AutomationSettings, ControlState, Provider, SourceControl, Stats } from '../../lib/api';
import type { RunKind } from '../../app/types';
import { SourcesPage } from '../sources/SourcesPage';
import type { Dispatch, SetStateAction } from 'react';

export function ResourcesPage({ view, setView, pool, providers, providerCatalog, onCreateProvider, onPatchProvider, onRefreshProvider }: {
  view: ResourceView;
  setView: (view: ResourceView) => void;
  pool: ProxyPoolPageProps;
  providers: {
    stats: Stats;
    control: ControlState;
    automation: AutomationSettings;
    controlSaving: boolean;
    controlError: string;
    validationActive: boolean;
    fullCollectionActive: boolean;
    activeSourceNames: string[];
    visibleSources: SourceControl[];
    sourcePage: number;
    sourceTotalPages: number;
    setAutomation: (value: AutomationSettings) => void;
    setSourcePage: Dispatch<SetStateAction<number>>;
    onToggleAutomation: () => void;
    onToggleAutoPurge: () => void;
    onSaveAutomation: () => Promise<void>;
    onRun: (kind: RunKind) => Promise<void>;
    onRunSource: (name: string) => Promise<void>;
    onToggleSource: (name: string, enabled: boolean) => Promise<void>;
    onLocked: (title: string, detail: string) => void;
  } | null;
  providerCatalog: Provider[];
  onCreateProvider: (provider: Partial<Provider>) => Promise<Provider>;
  onPatchProvider: (id: string, patch: Partial<Provider>) => Promise<Provider>;
  onRefreshProvider: (id: string) => Promise<Provider>;
}) {
  return (
    <div className={`resources-page view-${view}`}>
      <div className="resource-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'nodes'} className={view === 'nodes' ? 'active' : ''} onClick={() => setView('nodes')}><Boxes size={15} /><span>节点</span><small>{pool.proxyTotal.toLocaleString()}</small></button>
        <button role="tab" aria-selected={view === 'providers'} className={view === 'providers' ? 'active' : ''} onClick={() => setView('providers')}><Layers size={15} /><span>Provider</span><small>{providerCatalog.length + (providers?.control.sources.length ?? 0)}</small></button>
      </div>
      {view === 'nodes' && <ProxyPoolPage {...pool} />}
      {view === 'providers' && <><ProviderCatalog providers={providerCatalog} onCreate={onCreateProvider} onPatch={onPatchProvider} onRefresh={onRefreshProvider} />{providers && <SourcesPage {...providers} />}</>}
    </div>
  );
}

function ProviderCatalog({ providers, onCreate, onPatch, onRefresh }: { providers: Provider[]; onCreate: (provider: Partial<Provider>) => Promise<Provider>; onPatch: (id: string, patch: Partial<Provider>) => Promise<Provider>; onRefresh: (id: string) => Promise<Provider> }) {
  const [name, setName] = useState(''); const [url, setUrl] = useState(''); const [kind, setKind] = useState<Provider['kind']>('subscription'); const [saving, setSaving] = useState(false);
  const create = async () => { if (!name.trim()) return; setSaving(true); try { await onCreate({ name: name.trim(), url: url.trim() || null, kind }); setName(''); setUrl(''); } finally { setSaving(false); } };
  return <section className="provider-catalog work-panel"><div className="work-panel-head"><div><strong>订阅与长期 Provider</strong><span>与公共代理采集源分开管理，节点会进入 Mihomo 代理组</span></div><span>{providers.length} 个</span></div><div className="provider-create"><input aria-label="Provider 名称" placeholder="Provider 名称" value={name} onChange={(event) => setName(event.target.value)} /><input aria-label="订阅地址" placeholder="Clash URL / YAML URL（可选）" value={url} onChange={(event) => setUrl(event.target.value)} /><select aria-label="Provider 类型" value={kind} onChange={(event) => setKind(event.target.value as Provider['kind'])}><option value="subscription">订阅</option><option value="fixed">固定节点</option><option value="pool">代理池</option></select><button className="btn btn-primary" disabled={saving || !name.trim()} onClick={() => void create()}><Plus size={14} />添加</button></div>{providers.length === 0 ? <div className="provider-empty">尚未添加订阅或固定节点 Provider</div> : providers.map((provider) => <div className="provider-catalog-row" key={provider.id}><div><strong>{provider.name}</strong><span>{provider.kind} · {provider.nodes.length} 个节点{provider.lastError ? ` · ${provider.lastError}` : ''}</span></div><span className={`runtime-pill${provider.enabled ? ' online' : ''}`}>{provider.enabled ? '启用' : '停用'}</span><button className="btn btn-icon" title="切换 Provider" onClick={() => void onPatch(provider.id, { enabled: !provider.enabled })}>{provider.enabled ? '−' : '+'}</button>{provider.url && <button className="btn" onClick={() => void onRefresh(provider.id)}><RefreshCw size={13} />更新</button>}</div>)}</section>;
}
