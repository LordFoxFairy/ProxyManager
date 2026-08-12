import { Rocket } from 'lucide-react';
import type { Gateway } from '../lib/api';
import { NAVIGATION } from './navigation';
import type { Page } from './types';

export function AppSidebar({
  page,
  gateway,
  onNavigate,
}: {
  page: Page;
  gateway: Gateway | null;
  onNavigate: (page: Page) => void;
}) {
  return (
    <nav className="sidenav">
      <div className="brand">
        <span className="brand-mark"><Rocket size={22} /></span>
        <span className="brand-name">ProxyManager</span>
      </div>
      {NAVIGATION.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`nav-item${page === id ? ' active' : ''}`}
          title={label}
          onClick={() => onNavigate(id)}
        >
          <Icon size={18} />
          <span className="nav-label">{label}</span>
        </button>
      ))}
      <div className="nav-spacer" />
      <div
        className={`nav-exit${gateway?.currentProxy?.active ? ' active' : ''}`}
        title={gateway?.currentProxy
          ? `${gateway.currentProxy.upstream}\n出口 ${gateway.currentProxy.exitIp ?? '检测中'}`
          : '代理池暂无可用节点'}
      >
        <span className="nav-exit-dot" />
        <div className="nav-exit-copy">
          <span>{gateway?.currentProxy?.active ? '当前出口' : '候选出口'}</span>
          <strong>{gateway?.currentProxy?.exitIp ?? '等待节点'}</strong>
        </div>
      </div>
    </nav>
  );
}
