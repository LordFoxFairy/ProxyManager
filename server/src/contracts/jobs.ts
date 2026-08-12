export type ValidationStage = 'idle' | 'tcp' | 'proxy' | 'geo';

export interface ValidationProgress {
  stage: Exclude<ValidationStage, 'idle'>;
  total: number;
  completed: number;
  reachable: number;
  passed: number;
}

export interface CollectionJobState {
  running: boolean;
  full: boolean;
  sources: string[];
  startedAt: number | null;
  lastCompletedAt: number | null;
  fullLastCompletedAt: number | null;
  lastError: string | null;
}

export interface ValidationJobState {
  running: boolean;
  stage: ValidationStage;
  total: number;
  completed: number;
  reachable: number;
  passed: number;
  startedAt: number | null;
  lastCompletedAt: number | null;
  lastError: string | null;
}

export interface JobSnapshot {
  collection: CollectionJobState;
  validation: ValidationJobState;
  lastRun: number | null;
  lastCollectAt: number | null;
  lastValidateAt: number | null;
  log: string[];
}
