import type { ReactNode } from 'react';
import { Info, ShieldAlert } from 'lucide-react';

export function Stat({
  label,
  icon,
  value,
  sub,
  tone,
}: {
  label: string;
  icon?: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'accent' | 'good' | 'warn';
}) {
  return (
    <div className="card stat">
      <div className="stat-label">
        {icon}
        {label}
      </div>
      <div className={`stat-value${tone ? ` ${tone}` : ''}`}>{value}</div>
      {sub != null && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export function SchemeBadge({ scheme }: { scheme: string }) {
  return <span className={`badge badge-${scheme}`}>{scheme}</span>;
}

export function Score({ value }: { value: number }) {
  return (
    <div className="score">
      <div className="score-bar">
        <div className="score-fill" style={{ width: `${value}%` }} />
      </div>
      <span className="score-num">{value}</span>
    </div>
  );
}

export function Notice({ children, danger }: { children: ReactNode; danger?: boolean }) {
  return (
    <div className={`notice${danger ? ' offline' : ''}`}>
      <span className="notice-icon">
        {danger ? <ShieldAlert size={17} /> : <Info size={17} />}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Empty({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="icon">{icon}</div>
      <h3>{title}</h3>
      <p>{hint}</p>
      {action}
    </div>
  );
}

export const fmtAge = (ts: number | null) => {
  if (!ts) return '—';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`;
  return `${Math.round(s / 3600)} 小时前`;
};
