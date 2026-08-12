import { ScrollText } from 'lucide-react';
import { Empty } from '../../components/Pieces';

export function LogPage({ lines }: { lines: string[] }) {
  return (
    <div className="card">
      {lines.length === 0
        ? <Empty icon={<ScrollText size={34} />} title="暂无日志" hint="运行一次采集或校验后这里会有输出" />
        : <div className="log-view">{lines.join('\n')}</div>}
    </div>
  );
}
