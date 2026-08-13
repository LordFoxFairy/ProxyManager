import type { LucideIcon } from 'lucide-react';

export type Page = 'overview' | 'groups' | 'rules' | 'routing' | 'connections' | 'resources' | 'diagnostics' | 'activity';
export type ResourceView = 'nodes' | 'providers';
export type RunKind = 'validate' | 'collect' | 'source';

export interface RunIntent {
  id: string;
  kind: RunKind;
  label: string;
  source?: string;
  startedAt: number;
}

export interface ToastMessage {
  id: number;
  tone: 'info' | 'success' | 'danger';
  title: string;
  detail: string;
}

export interface NavigationItem {
  id: Page;
  label: string;
  icon: LucideIcon;
}
