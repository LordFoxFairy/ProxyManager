import type { AutomationSettings } from '../core/control.js';
import { JobOrchestrator } from './job-orchestrator.js';
import { listRuleProviders, refreshRuleProvider, ruleProviderDue } from '../core/rules.js';
import { mihomo } from '../core/mihomo.js';

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
    const dueProviders = listRuleProviders().filter((provider) => ruleProviderDue(provider, now));
    for (const provider of dueProviders) {
      tasks.push(refreshRuleProvider(provider.id).then(() => {
        void mihomo.reload().catch(() => undefined);
      }).catch(() => undefined));
    }
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
    const nextRule = listRuleProviders().filter((provider) => provider.enabled && provider.url)
      .reduce((next, provider) => Math.min(next, (provider.updatedAt ?? after) + provider.interval * 1000), Number.POSITIVE_INFINITY);
    this.schedule(Math.min(nextCollect, nextValidate, nextRule) - after);
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

  stop() {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
