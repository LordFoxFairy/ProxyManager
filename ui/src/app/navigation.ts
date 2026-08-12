import { Activity, Boxes, Gauge, Route, ScanSearch, Waypoints } from 'lucide-react';
import type { NavigationItem } from './types';

export const NAVIGATION: NavigationItem[] = [
  { id: 'overview', label: '总览', icon: Gauge },
  { id: 'routing', label: '路由', icon: Route },
  { id: 'connections', label: '连接', icon: Waypoints },
  { id: 'resources', label: '资源', icon: Boxes },
  { id: 'diagnostics', label: '诊断', icon: ScanSearch },
  { id: 'activity', label: '活动', icon: Activity },
];
