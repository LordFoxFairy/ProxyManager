import { Activity, Download, ScrollText } from 'lucide-react';
import type { Stats } from '../../lib/api';

export function JobMonitor({
  stats,
  collectionActive,
  validationActive,
  fullCollectionStarting,
  validationStarting,
  activeSourceNames,
  validationStageLabel,
  validationPercent,
  onOpenLog,
}: {
  stats: Stats;
  collectionActive: boolean;
  validationActive: boolean;
  fullCollectionStarting: boolean;
  validationStarting: boolean;
  activeSourceNames: string[];
  validationStageLabel: string;
  validationPercent: number;
  onOpenLog: () => void;
}) {
  const validation = stats.jobs.validation;
  return (
    <section className="task-status" role="status" aria-live="polite">
      {collectionActive && (
        <div className="task-lane collection">
          <span className="task-status-icon"><Download size={16} /></span>
          <div className="task-status-copy">
            <strong>{fullCollectionStarting ? '正在启动来源更新' : `正在更新 ${Math.max(1, activeSourceNames.length)} 个来源`}</strong>
            <span>{activeSourceNames.length ? activeSourceNames.slice(0, 3).join('、') : '正在准备来源列表'}</span>
            <span className="task-progress indeterminate" aria-hidden="true"><span /></span>
          </div>
        </div>
      )}
      {validationActive && (
        <div className="task-lane validation">
          <span className="task-status-icon"><Activity size={16} /></span>
          <div className="task-status-copy">
            <strong>{validationStarting ? '正在启动健康检查' : validationStageLabel}</strong>
            <span>
              {validation.stage === 'tcp'
                ? `${validation.completed} / ${validation.total} · ${validation.reachable} 个 TCP 可达`
                : validation.stage === 'proxy'
                  ? `${validation.completed} / ${validation.total} · ${validation.passed} 个代理通过`
                  : validation.stage === 'geo'
                    ? `${validation.passed} 个出口正在补全地区`
                    : '正在准备待检队列'}
            </span>
            <span className="task-progress" aria-hidden="true">
              <span style={{ width: `${validationPercent}%` }} />
            </span>
          </div>
        </div>
      )}
      <button className="task-log-link" onClick={onOpenLog}>
        <ScrollText size={14} />
        查看日志
      </button>
    </section>
  );
}
