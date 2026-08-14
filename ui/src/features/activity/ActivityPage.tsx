import { Activity, Download, ScrollText, ShieldCheck } from 'lucide-react';
import { Empty, Stat, fmtAge } from '../../components/Pieces';
import type { ControlState, JobRun, Stats } from '../../lib/api';

export function ActivityPage({ stats, control, lines, runs }: { stats: Stats; control: ControlState | null; lines: string[]; runs: JobRun[] }) {
  const collection = stats.jobs.collection;
  const validation = stats.jobs.validation;
  return (
    <>
      <div className="stat-grid activity-stats">
        <Stat label="来源更新" icon={<Download size={13} />} value={collection.running ? '运行中' : '空闲'} sub={collection.lastCompletedAt ? fmtAge(collection.lastCompletedAt) : '无完成记录'} tone={collection.running ? 'accent' : undefined} />
        <Stat label="健康检查" icon={<ShieldCheck size={13} />} value={validation.running ? '运行中' : '空闲'} sub={validation.lastCompletedAt ? fmtAge(validation.lastCompletedAt) : '无完成记录'} tone={validation.running ? 'accent' : undefined} />
        <Stat label="待处理节点" icon={<Activity size={13} />} value={stats.unchecked.toLocaleString()} />
        <Stat label="已启用来源" icon={<ScrollText size={13} />} value={control?.sources.filter((source) => source.enabled).length ?? 0} sub={`共 ${control?.sources.length ?? 0} 个 Provider`} />
      </div>
      <section className="work-panel">
        <div className="work-panel-head"><div><strong>运行活动</strong><span>来源更新、健康流水线与错误记录</span></div></div>
        {lines.length === 0
          ? <Empty icon={<ScrollText size={34} />} title="暂无活动" hint="运行一次 Provider 更新或健康检查后，这里会出现记录" />
          : <div className="log-view activity-log">{lines.join('\n')}</div>}
      </section>
      <section className="work-panel job-history-panel">
        <div className="work-panel-head"><div><strong>任务历史</strong><span>采集与健康检查的批次、耗时和失败原因</span></div><span>{runs.length} 条</span></div>
        {runs.length === 0 ? <Empty icon={<ScrollText size={34} />} title="暂无任务历史" hint="完成一次采集或健康检查后会记录批次" /> : <div className="job-history-list">{runs.map((run) => <div className="job-history-row" key={run.id}><span className={`runtime-pill${run.status === 'success' ? ' online' : ''}`}>{run.status === 'success' ? '成功' : run.status === 'failed' ? '失败' : '运行中'}</span><strong>{run.kind === 'collect' ? '来源采集' : '健康检查'}</strong><span>{new Date(run.startedAt).toLocaleString()}</span><span>{run.finishedAt ? `${Math.max(0, run.finishedAt - run.startedAt)}ms` : '进行中'}</span><small>{run.error ?? (run.kind === 'collect' ? String(run.metadata.sources ?? '') : `批量 ${String(run.metadata.limit ?? '')}`)}</small></div>)}</div>}
      </section>
    </>
  );
}
