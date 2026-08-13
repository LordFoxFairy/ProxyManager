import { getRuntimeConfig, updateRuntimeConfig, type RuntimeConfig } from './runtime.js';
import { listProviders, replaceProviders, type Provider } from './providers.js';
import { listGroups, replaceGroups, type ProxyGroup } from './groups.js';
import { listRules, listRuleProviders, replaceRules, replaceRuleProviders, type RoutingRule, type RuleProvider } from './rules.js';
import { getAutomationSettings, updateAutomationSettings, type AutomationSettings } from './control.js';
import { getGatewayRouting, updateGatewayRouting, type GatewayRouting } from './routing.js';
import { listCustomConnectivityTargets, replaceCustomConnectivityTargets, type ConnectivityTarget } from './connectivity.js';

export interface ConfigBundle { format: 'proxymanager-config'; version: 1; exportedAt: number; runtime: RuntimeConfig; automation: AutomationSettings; routing: GatewayRouting; customConnectivityTargets: ConnectivityTarget[]; providers: Provider[]; groups: ProxyGroup[]; rules: RoutingRule[]; ruleProviders: RuleProvider[]; }
export function exportConfigBundle(): ConfigBundle { return { format: 'proxymanager-config', version: 1, exportedAt: Date.now(), runtime: getRuntimeConfig(), automation: getAutomationSettings(), routing: getGatewayRouting(), customConnectivityTargets: listCustomConnectivityTargets(), providers: listProviders(), groups: listGroups(), rules: listRules(), ruleProviders: listRuleProviders() }; }
function validateBundle(row: Partial<ConfigBundle>) {
  if (row.format !== 'proxymanager-config' || row.version !== 1 || !row.runtime || !Array.isArray(row.providers) || !Array.isArray(row.groups) || !Array.isArray(row.rules) || !Array.isArray(row.ruleProviders)) throw new Error('不支持的 ProxyManager 配置版本');
  for (const [name, values] of [['providers', row.providers], ['groups', row.groups], ['rules', row.rules], ['ruleProviders', row.ruleProviders]] as const) {
    if (values.some((item) => !item || typeof item !== 'object')) throw new Error(`${name} 包含无效条目`);
  }
  if (row.customConnectivityTargets && (!Array.isArray(row.customConnectivityTargets) || row.customConnectivityTargets.some((item) => !item || typeof item !== 'object'))) throw new Error('连通性目标格式无效');
}

export function importConfigBundle(input: unknown): ConfigBundle {
  if (!input || typeof input !== 'object') throw new Error('配置文件格式无效');
  const row = input as Partial<ConfigBundle>; validateBundle(row);
  const backup = exportConfigBundle();
  try {
    updateRuntimeConfig(row.runtime); if (row.automation) updateAutomationSettings(row.automation); if (row.routing) updateGatewayRouting(row.routing);
    if (row.customConnectivityTargets) replaceCustomConnectivityTargets(row.customConnectivityTargets);
    replaceProviders(row.providers!); replaceGroups(row.groups!); replaceRules(row.rules!); replaceRuleProviders(row.ruleProviders!);
    return exportConfigBundle();
  } catch (error) {
    updateRuntimeConfig(backup.runtime); updateAutomationSettings(backup.automation); updateGatewayRouting(backup.routing);
    replaceCustomConnectivityTargets(backup.customConnectivityTargets); replaceProviders(backup.providers); replaceGroups(backup.groups); replaceRules(backup.rules); replaceRuleProviders(backup.ruleProviders);
    throw error;
  }
}
