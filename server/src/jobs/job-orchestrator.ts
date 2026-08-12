import type { JobSnapshot, ValidationProgress } from '../contracts/jobs.js';

interface SourceStatus {
  name: string;
  enabled: boolean;
}

export interface JobOrchestratorDependencies {
  collect: (log: (message: string) => void, sources?: string[]) => Promise<unknown>;
  validate: (
    limit: number,
    log: (message: string) => void,
    onProgress: (progress: ValidationProgress) => void,
  ) => Promise<unknown>;
  sourceStatuses: () => SourceStatus[];
  now?: () => number;
  output?: (message: string) => void;
}

export class JobOrchestrator {
  private readonly collectingSources = new Set<string>();
  private fullCollectionRunning = false;
  private collectionStartedAt: number | null = null;
  private collectionLastCompletedAt: number | null = null;
  private fullCollectionLastCompletedAt: number | null = null;
  private collectionLastError: string | null = null;
  private lastRun: number | null = null;
  private lastCollectAt: number | null = null;
  private lastValidateAt: number | null = null;
  private readonly logLines: string[] = [];
  private validation = {
    running: false,
    stage: 'idle' as const satisfies JobSnapshot['validation']['stage'],
    total: 0,
    completed: 0,
    reachable: 0,
    passed: 0,
    startedAt: null as number | null,
    lastCompletedAt: null as number | null,
    lastError: null as string | null,
  } as JobSnapshot['validation'];

  constructor(private readonly dependencies: JobOrchestratorDependencies) {}

  private now() {
    return this.dependencies.now?.() ?? Date.now();
  }

  note = (message: string) => {
    this.dependencies.output?.(message);
    this.logLines.push(`${new Date(this.now()).toISOString().slice(11, 19)} ${message}`);
    if (this.logLines.length > 200) this.logLines.shift();
  };

  snapshot(): JobSnapshot {
    return {
      collection: {
        running: this.collectingSources.size > 0,
        full: this.fullCollectionRunning,
        sources: [...this.collectingSources],
        startedAt: this.collectionStartedAt,
        lastCompletedAt: this.collectionLastCompletedAt,
        fullLastCompletedAt: this.fullCollectionLastCompletedAt,
        lastError: this.collectionLastError,
      },
      validation: { ...this.validation },
      lastRun: this.lastRun,
      lastCollectAt: this.lastCollectAt,
      lastValidateAt: this.lastValidateAt,
      log: [...this.logLines],
    };
  }

  startCollection(sourceNames?: string[], countsForSchedule = false): Promise<void> | null {
    if (countsForSchedule && this.fullCollectionRunning) return null;
    const configured = this.dependencies.sourceStatuses();
    const requested = sourceNames?.length
      ? sourceNames
      : configured.filter((source) => source.enabled).map((source) => source.name);
    const available = requested.filter((name) => !this.collectingSources.has(name));
    if (!available.length) return null;

    for (const name of available) this.collectingSources.add(name);
    if (countsForSchedule) this.fullCollectionRunning = true;
    this.collectionStartedAt ??= this.now();
    this.collectionLastError = null;

    return (async () => {
      try {
        await this.dependencies.collect(this.note, available);
      } catch (error) {
        this.collectionLastError = (error as Error).message;
        this.note(`collection failed: ${this.collectionLastError}`);
      } finally {
        for (const name of available) this.collectingSources.delete(name);
        if (countsForSchedule) {
          this.fullCollectionRunning = false;
          this.lastCollectAt = this.now();
          this.fullCollectionLastCompletedAt = this.lastCollectAt;
        }
        if (!this.collectingSources.size) {
          this.collectionStartedAt = null;
          this.collectionLastCompletedAt = this.now();
        }
        this.lastRun = this.now();
      }
    })();
  }

  startValidation(limit: number): Promise<void> | null {
    if (this.validation.running) return null;
    this.validation = {
      running: true,
      stage: 'tcp',
      total: 0,
      completed: 0,
      reachable: 0,
      passed: 0,
      startedAt: this.now(),
      lastCompletedAt: this.validation.lastCompletedAt,
      lastError: null,
    };

    return (async () => {
      try {
        await this.dependencies.validate(limit, this.note, (progress) => {
          this.validation = { ...this.validation, ...progress };
        });
      } catch (error) {
        this.validation.lastError = (error as Error).message;
        this.note(`validation failed: ${this.validation.lastError}`);
      } finally {
        this.validation.running = false;
        this.validation.stage = 'idle';
        this.validation.lastCompletedAt = this.now();
        this.lastValidateAt = this.now();
        this.lastRun = this.now();
      }
    })();
  }

  async cycle(collectFirst: boolean, limit: number, sourceNames?: string[]) {
    const tasks: Promise<void>[] = [];
    if (collectFirst) {
      const collection = this.startCollection(sourceNames, !sourceNames?.length);
      if (collection) tasks.push(collection);
    }
    const validation = this.startValidation(limit);
    if (validation) tasks.push(validation);
    await Promise.all(tasks);
  }
}
