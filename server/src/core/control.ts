import { COLLECT_INTERVAL, RECHECK_INTERVAL, VALIDATE_BATCH } from '../config.js';
import { getSetting, setSetting } from './store.js';

export interface AutomationSettings {
  enabled: boolean;
  autoPurgeEnabled: boolean;
  collectIntervalMinutes: number;
  recheckIntervalMinutes: number;
  validateBatch: number;
}

const DEFAULTS: AutomationSettings = {
  enabled: true,
  autoPurgeEnabled: true,
  collectIntervalMinutes: Math.max(5, Math.round(COLLECT_INTERVAL / 60_000)),
  recheckIntervalMinutes: Math.max(1, Math.round(RECHECK_INTERVAL / 60_000)),
  validateBatch: VALIDATE_BATCH,
};

const KEYS = {
  enabled: 'automation.enabled',
  autoPurgeEnabled: 'automation.auto_purge_enabled',
  collectIntervalMinutes: 'automation.collect_interval_minutes',
  recheckIntervalMinutes: 'automation.recheck_interval_minutes',
  validateBatch: 'automation.validate_batch',
} as const;

const numberSetting = (key: string, fallback: number) => {
  const raw = getSetting(key);
  if (raw === null) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.round(parsed))) : fallback;
};

export function getAutomationSettings(): AutomationSettings {
  return {
    enabled: getSetting(KEYS.enabled) !== '0',
    autoPurgeEnabled: getSetting(KEYS.autoPurgeEnabled) !== '0',
    collectIntervalMinutes: clampInt(
      numberSetting(KEYS.collectIntervalMinutes, DEFAULTS.collectIntervalMinutes),
      5,
      1440,
      DEFAULTS.collectIntervalMinutes,
    ),
    recheckIntervalMinutes: clampInt(
      numberSetting(KEYS.recheckIntervalMinutes, DEFAULTS.recheckIntervalMinutes),
      1,
      120,
      DEFAULTS.recheckIntervalMinutes,
    ),
    validateBatch: clampInt(
      numberSetting(KEYS.validateBatch, DEFAULTS.validateBatch),
      50,
      5000,
      DEFAULTS.validateBatch,
    ),
  };
}

export function updateAutomationSettings(input: unknown): AutomationSettings {
  const current = getAutomationSettings();
  if (!input || typeof input !== 'object') return current;
  const patch = input as Record<string, unknown>;

  if (typeof patch.enabled === 'boolean') {
    setSetting(KEYS.enabled, patch.enabled ? '1' : '0');
  }
  if (typeof patch.autoPurgeEnabled === 'boolean') {
    setSetting(KEYS.autoPurgeEnabled, patch.autoPurgeEnabled ? '1' : '0');
  }
  if (patch.collectIntervalMinutes !== undefined) {
    setSetting(
      KEYS.collectIntervalMinutes,
      String(clampInt(patch.collectIntervalMinutes, 5, 1440, current.collectIntervalMinutes)),
    );
  }
  if (patch.recheckIntervalMinutes !== undefined) {
    setSetting(
      KEYS.recheckIntervalMinutes,
      String(clampInt(patch.recheckIntervalMinutes, 1, 120, current.recheckIntervalMinutes)),
    );
  }
  if (patch.validateBatch !== undefined) {
    setSetting(
      KEYS.validateBatch,
      String(clampInt(patch.validateBatch, 50, 5000, current.validateBatch)),
    );
  }
  return getAutomationSettings();
}
