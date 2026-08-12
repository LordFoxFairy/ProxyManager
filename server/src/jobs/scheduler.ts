import type { AutomationSettings } from '../core/control.js';
import { JobOrchestrator } from './job-orchestrator.js';

export class JobScheduler {
  private started = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jobs: JobOrchestrator,
    private readonly getSettings: () => AutomationSettings,
  ) {}

  private schedule(delay: number) {
    if (!this.started) return;
    this.timer = setTimeout(() => void this.tick(), Math.max(50, delay));
  }

  private async tick() {
    const automation = this.getSettings();
    if (!automation.enabled) {
      this.schedule(30_000);
      return;
    }

    const state = this.jobs.snapshot();
    const now = Date.now();
    const collectDue = state.lastCollectAt === null ||
      now - state.lastCollectAt >= automation.collectIntervalMinutes * 60_000;
    const validateDue = state.lastValidateAt === null ||
      now - state.lastValidateAt >= automation.recheckIntervalMinutes * 60_000;
    const tasks: Promise<void>[] = [];
    if (collectDue) {
      const collection = this.jobs.startCollection(undefined, true);
      if (collection) tasks.push(collection);
    }
    if (validateDue) {
      const validation = this.jobs.startValidation(automation.validateBatch);
      if (validation) tasks.push(validation);
    }
    await Promise.all(tasks);

    const latest = this.getSettings();
    if (!latest.enabled) {
      this.schedule(30_000);
      return;
    }
    const afterState = this.jobs.snapshot();
    const after = Date.now();
    const nextCollect = (afterState.lastCollectAt ?? after) + latest.collectIntervalMinutes * 60_000;
    const nextValidate = (afterState.lastValidateAt ?? after) + latest.recheckIntervalMinutes * 60_000;
    this.schedule(Math.min(nextCollect, nextValidate) - after);
  }

  reschedule = () => {
    if (!this.started) return;
    if (this.timer) clearTimeout(this.timer);
    this.schedule(50);
  };

  start() {
    if (!this.started) {
      this.started = true;
      this.schedule(50);
    }
    return this.timer;
  }
}
