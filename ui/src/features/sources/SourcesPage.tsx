import type { Dispatch, SetStateAction } from 'react';
import { Activity, ChevronLeft, ChevronRight, Download, Play, Power, Radar, RefreshCw, Save, Timer } from 'lucide-react';
import { ActionGuard } from '../../components/ActionGuard';
import { Notice, fmtAge } from '../../components/Pieces';
import type { AutomationSettings, ControlState, SourceControl, Stats } from '../../lib/api';
import type { RunKind } from '../../app/types';

const fmtDue = (timestamp: number | null) => {
  if (!timestamp) return '已暂停';
  const seconds = Math.max(0, Math.round((timestamp - Date.now()) / 1000));
  if (seconds < 10) return '即将执行';
  if (seconds < 60) return `${seconds} 秒后`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分钟后`;
  return `${Math.ceil(seconds / 3600)} 小时后`;
};

const sourceHost = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export function SourcesPage({
  stats,
  control,
  automation,
  controlSaving,
  controlError,
  validationActive,
  fullCollectionActive,
  activeSourceNames,
  visibleSources,
  sourcePage,
  sourceTotalPages,
  setAutomation,
  setSourcePage,
  onToggleAutomation,
  onToggleAutoPurge,
  onSaveAutomation,
  onRun,
  onRunSource,
  onToggleSource,
  onLocked,
}: {
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
}) {
  return (
    <>
      {controlError && <Notice danger>{controlError}</Notice>}

      <section className="patrol-console">
        <div className="patrol-head">
          <span className={`patrol-icon${automation.enabled ? ' active' : ''}`}><Radar size={19} /></span>
          <div><strong>自动巡航</strong><span>{automation.enabled ? '运行中' : '已暂停'}</span></div>
          <span className="grow" />
          <label className="switch-control" title="评分归零后进入冷却区，过期后可重新采集">
            <input type="checkbox" checked={automation.autoPurgeEnabled} disabled={controlSaving} onChange={onToggleAutoPurge} />
            <span className="switch-track"><span /></span><span>自动剔除</span>
          </label>
          <label className="switch-control">
            <input type="checkbox" checked={automation.enabled} disabled={controlSaving} onChange={onToggleAutomation} />
            <span className="switch-track"><span /></span><span>{automation.enabled ? '开启' : '关闭'}</span>
          </label>
        </div>

        <div className="patrol-settings">
          <label>
            <span>复检间隔</span>
            <div className="number-field"><input type="number" min={1} max={120} value={automation.recheckIntervalMinutes} onChange={(event) => setAutomation({ ...automation, recheckIntervalMinutes: Number(event.target.value) })} /><span>分钟</span></div>
          </label>
          <label>
            <span>采集间隔</span>
            <div className="number-field"><input type="number" min={5} max={1440} value={automation.collectIntervalMinutes} onChange={(event) => setAutomation({ ...automation, collectIntervalMinutes: Number(event.target.value) })} /><span>分钟</span></div>
          </label>
          <label>
            <span>单轮校验</span>
            <div className="number-field"><input type="number" min={50} max={5000} step={50} value={automation.validateBatch} onChange={(event) => setAutomation({ ...automation, validateBatch: Number(event.target.value) })} /><span>条</span></div>
          </label>
          <button className="btn" disabled={controlSaving} onClick={() => void onSaveAutomation()}><Save size={15} />保存设置</button>
        </div>

        <div className="patrol-foot">
          <span><Timer size={14} /> 下次复检 {fmtDue(control.scheduler.nextValidateAt)}</span>
          <span><Download size={14} /> 下次采集 {fmtDue(control.scheduler.nextCollectAt)}</span>
          <span className="grow" />
          <ActionGuard locked={validationActive} reason="健康检查已在运行" onLocked={() => onLocked('健康检查正在运行', '当前检查不会阻塞来源更新。')}>
            <button className="btn" onClick={() => void onRun('validate')}>
              {validationActive ? <RefreshCw size={14} className="spin" /> : <Activity size={14} />}{validationActive ? '检查中' : '健康检查'}
            </button>
          </ActionGuard>
          <ActionGuard locked={fullCollectionActive} reason="全量来源更新已在运行" onLocked={() => onLocked('来源正在更新', '健康检查仍可独立启动或继续运行。')}>
            <button className="btn btn-primary" onClick={() => void onRun('collect')}>
              {fullCollectionActive ? <RefreshCw size={14} className="spin" /> : <Download size={14} />}{fullCollectionActive ? '更新中' : '更新全部来源'}
            </button>
          </ActionGuard>
        </div>
      </section>

      <div className="source-metrics">
        <div><span>启用采集源</span><strong>{control.sources.filter((source) => source.enabled).length}<small> / {control.sources.length}</small></strong></div>
        <div><span>最近发现候选</span><strong>{control.sources.reduce((sum, source) => sum + (source.lastCandidates ?? 0), 0).toLocaleString()}</strong></div>
        <div><span>当前池 / 冷却中</span><strong>{stats.total.toLocaleString()}<small> · {stats.buried.toLocaleString()}</small></strong></div>
        <div><span>HTTPS 可用</span><strong>{stats.liveHttps.toLocaleString()}<small> · {stats.live ? ((stats.liveHttps / stats.live) * 100).toFixed(1) : '0.0'}%</small></strong></div>
      </div>

      <section className="source-console">
        <div className="source-console-head">
          <div>
            <strong>采集源管理</strong>
            <span>{activeSourceNames.length ? `${activeSourceNames.length} 个来源更新中` : '来源空闲'} · {control.sources.filter((source) => source.recommended).length} 个默认推荐 · 第 {Math.min(sourcePage, sourceTotalPages)} / {sourceTotalPages} 页</span>
          </div>
          <Power size={16} aria-label="来源开关均可独立控制" />
        </div>

        <div className="source-table-head">
          <span className="source-col-identity">来源</span><span className="source-col-scheme">协议</span><span className="source-col-candidates">最近采集</span><span className="source-col-health">入库 / 有效率</span><span className="source-col-state">状态</span><span className="source-col-actions">操作</span>
        </div>

        {visibleSources.map((source) => (
          <SourceRow
            key={source.name}
            source={source}
            active={activeSourceNames.includes(source.name)}
            onRun={onRunSource}
            onToggle={onToggleSource}
            onLocked={onLocked}
          />
        ))}
        <div className="source-pagination">
          <span>共 {control.sources.length} 个来源</span><span className="grow" />
          <button className="btn btn-icon" title="上一页" disabled={sourcePage <= 1} onClick={() => setSourcePage((current) => Math.max(1, current - 1))}><ChevronLeft size={15} /></button>
          <div className="page-numbers">
            {Array.from({ length: sourceTotalPages }, (_, index) => index + 1).map((value) => <button className={value === sourcePage ? 'active' : ''} key={value} onClick={() => setSourcePage(value)}>{value}</button>)}
          </div>
          <button className="btn btn-icon" title="下一页" disabled={sourcePage >= sourceTotalPages} onClick={() => setSourcePage((current) => Math.min(sourceTotalPages, current + 1))}><ChevronRight size={15} /></button>
        </div>
      </section>
    </>
  );
}

function SourceRow({
  source,
  active,
  onRun,
  onToggle,
  onLocked,
}: {
  source: SourceControl;
  active: boolean;
  onRun: (name: string) => Promise<void>;
  onToggle: (name: string, enabled: boolean) => Promise<void>;
  onLocked: (title: string, detail: string) => void;
}) {
  const rateBase = source.lastCandidates ?? source.total;
  const rate = rateBase ? (source.live / rateBase) * 100 : 0;
  return (
    <div className={`source-control-row${source.enabled ? '' : ' disabled'}${active ? ' running' : ''}`}>
      <div className="source-identity" title={source.url}>
        <div className="source-name-line"><strong>{source.name}</strong>{source.recommended && <span className="source-recommended">推荐</span>}</div>
        <span>{sourceHost(source.url)}</span>
      </div>
      <span className={`source-scheme ${source.scheme ?? 'mixed'}`}>{source.scheme ?? 'mixed'}</span>
      <div className="source-candidates"><strong>{source.lastCandidates?.toLocaleString() ?? '—'}</strong><span>{source.durationMs != null ? `${source.durationMs}ms` : '尚未运行'}</span></div>
      <div className="source-health">
        <div><strong>{source.total.toLocaleString()} / {source.live.toLocaleString()}</strong><span>{rate.toFixed(1)}%</span></div>
        <span className="source-health-track"><span style={{ width: `${Math.min(rate, 100)}%` }} /></span>
      </div>
      <div className={`source-state${source.lastError ? ' error' : ''}`}>
        <span className="source-state-dot" />
        <div><strong>{active ? '本轮处理中' : source.lastError ? '失败' : source.enabled ? '已启用' : '已停用'}</strong><span>{active ? '完成后自动恢复' : source.lastRun ? fmtAge(source.lastRun) : '无记录'}</span></div>
      </div>
      <div className="source-actions">
        <label className="mini-switch" title={source.enabled ? '停用采集源' : '启用采集源'}>
          <input type="checkbox" checked={source.enabled} onChange={(event) => void onToggle(source.name, event.target.checked)} /><span><span /></span>
        </label>
        <ActionGuard locked={active} reason={`${source.name} 正在更新`} onLocked={() => onLocked('该来源正在更新', `${source.name} 完成后会自动恢复。`)}>
          <button className="btn btn-icon" title={active ? undefined : `立即采集 ${source.name}`} aria-label={`立即采集 ${source.name}`} onClick={() => void onRun(source.name)}>
            {active ? <RefreshCw size={14} className="spin" /> : <Play size={14} />}
          </button>
        </ActionGuard>
      </div>
    </div>
  );
}
