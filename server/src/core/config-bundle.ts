import { getRuntimeConfig, updateRuntimeConfig, type RuntimeConfig } from './runtime.js';
import { listProviders, replaceProviders, type Provider } from './providers.js';
import { listGroups, replaceGroups, type ProxyGroup } from './groups.js';
import { listRules, listRuleProviders, replaceRules, replaceRuleProviders, type RoutingRule, type RuleProvider } from './rules.js';

export interface ConfigBundle { format: 'proxymanager-config'; version: 1; exportedAt: number; runtime: RuntimeConfig; providers: Provider[]; groups: ProxyGroup[]; rules: RoutingRule[]; ruleProviders: RuleProvider[]; }
export function exportConfigBundle(): ConfigBundle { return { format: 'proxymanager-config', version: 1, exportedAt: Date.now(), runtime: getRuntimeConfig(), providers: listProviders(), groups: listGroups(), rules: listRules(), ruleProviders: listRuleProviders() }; }
export function importConfigBundle(input: unknown): ConfigBundle { if (!input || typeof input !== 'object') throw new Error('配置文件格式无效'); const row = input as Partial<ConfigBundle>; if (row.format !== 'proxymanager-config' || row.version !== 1 || !row.runtime || !Array.isArray(row.providers) || !Array.isArray(row.groups) || !Array.isArray(row.rules) || !Array.isArray(row.ruleProviders)) throw new Error('不支持的 ProxyManager 配置版本'); updateRuntimeConfig(row.runtime); replaceProviders(row.providers); replaceGroups(row.groups); replaceRules(row.rules); replaceRuleProviders(row.ruleProviders); return exportConfigBundle(); }
