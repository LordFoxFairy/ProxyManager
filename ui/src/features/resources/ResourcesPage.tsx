import { Boxes, Layers } from 'lucide-react';
import type { ResourceView } from '../../app/types';
import type { ProxyPoolPageProps } from '../proxy-pool/ProxyPoolPage';
import { ProxyPoolPage } from '../proxy-pool/ProxyPoolPage';
import type { AutomationSettings, ControlState, SourceControl, Stats } from '../../lib/api';
import type { RunKind } from '../../app/types';
import { SourcesPage } from '../sources/SourcesPage';
import type { Dispatch, SetStateAction } from 'react';

export function ResourcesPage({ view, setView, pool, providers }: {
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
}) {
  return (
    <div className={`resources-page view-${view}`}>
      <div className="resource-tabs" role="tablist">
        <button role="tab" aria-selected={view === 'nodes'} className={view === 'nodes' ? 'active' : ''} onClick={() => setView('nodes')}><Boxes size={15} /><span>节点</span><small>{pool.proxyTotal.toLocaleString()}</small></button>
        <button role="tab" aria-selected={view === 'providers'} className={view === 'providers' ? 'active' : ''} onClick={() => setView('providers')}><Layers size={15} /><span>Provider</span><small>{providers?.control.sources.length ?? 0}</small></button>
      </div>
      {view === 'nodes' && <ProxyPoolPage {...pool} />}
      {view === 'providers' && providers && <SourcesPage {...providers} />}
    </div>
  );
}
