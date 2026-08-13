import { Notice } from './components/Pieces';
import { ActionToast } from './app/ActionToast';
import { AppSidebar } from './app/AppSidebar';
import { NAVIGATION } from './app/navigation';
import { ProxyManagerProvider, useProxyManager } from './app/ProxyManagerProvider';
import { ActivityPage } from './features/activity/ActivityPage';
import { ConnectionsPage } from './features/connections/ConnectionsPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DiagnosticsPage } from './features/diagnostics/DiagnosticsPage';
import { GatewayPage } from './features/gateway/GatewayPage';
import { JobMonitor } from './features/jobs/JobMonitor';
import { ResourcesPage } from './features/resources/ResourcesPage';
import { ProxyGroupsPage } from './features/groups/ProxyGroupsPage';
import { RulesPage } from './features/rules/RulesPage';
import './styles/base.css';
import './styles/app.css';

function ProxyManagerApp() {
  const model = useProxyManager();
  const { page, setPage, stats, gateway, control, automationDraft, offline } = model;

  const poolProps = {
    offline,
    proxies: model.proxies,
    proxyTotal: model.proxyTotal,
    proxyPage: model.proxyPage,
    proxyPageSize: model.proxyPageSize,
    proxyTotalPages: model.proxyTotalPages,
    proxySearch: model.proxySearch,
    scheme: model.scheme,
    country: model.country,
    anonymity: model.anonymity,
    minScore: model.minScore,
    targetFilter: model.targetFilter,
    onlyHttps: model.onlyHttps,
    countryOptions: model.countryOptions,
    targetOptions: model.targetOptions,
    selectedProxy: model.selectedProxy,
    connectivityTargets: model.connectivityTargets,
    connectivityResults: model.connectivityResults,
    connectivityLoading: model.connectivityLoading,
    connectivityCheckedAt: model.connectivityCheckedAt,
    connectivityError: model.connectivityError,
    copied: model.copied,
    setProxySearch: model.setProxySearch,
    setScheme: model.setScheme,
    setCountry: model.setCountry,
    setAnonymity: model.setAnonymity,
    setMinScore: model.setMinScore,
    setTargetFilter: model.setTargetFilter,
    setOnlyHttps: model.setOnlyHttps,
    setProxyPage: model.setProxyPage,
    setProxyPageSize: model.setProxyPageSize,
    setSelectedProxy: model.setSelectedProxy,
    resetFilters: model.resetProxyFilters,
    runConnectivity: model.runConnectivity,
    inspectProxy: model.inspectProxy,
    openDiagnostics: model.openProxyDiagnostics,
    onLocked: model.announceLockedAction,
    copy: model.copy,
    dropProxy: model.dropProxy,
  };

  const providerProps = stats && control && automationDraft ? {
    stats,
    control,
    automation: automationDraft,
    controlSaving: model.controlSaving,
    controlError: model.controlError,
    validationActive: model.validationActive,
    fullCollectionActive: model.fullCollectionActive,
    activeSourceNames: model.activeSourceNames,
    visibleSources: model.visibleSources,
    sourcePage: model.sourcePage,
    sourceTotalPages: model.sourceTotalPages,
    setAutomation: model.setAutomationDraft,
    setSourcePage: model.setSourcePage,
    onToggleAutomation: model.toggleAutomation,
    onToggleAutoPurge: model.toggleAutoPurge,
    onSaveAutomation: model.saveAutomation,
    onRun: model.startRun,
    onRunSource: model.runSource,
    onToggleSource: model.toggleSource,
    onLocked: model.announceLockedAction,
  } : null;

  return (
    <div className="app">
      <AppSidebar page={page} gateway={gateway} onNavigate={setPage} />
      <main className={`main page-${page}${page === 'resources' ? ` resource-view-${model.resourceView}` : ''}`}>
        <h1 className="page-title">{NAVIGATION.find((item) => item.id === page)?.label}</h1>

        {offline && <Notice danger><strong>后端服务未连接</strong><br />请确认 ProxyManager API 已在本机启动。</Notice>}
        {!offline && gateway && !gateway.running && <Notice danger><strong>本地代理端口未启动</strong><br />端口可能被占用；设置 <code>PM_GATEWAY_PORT</code> 后重启服务。</Notice>}
        {stats?.lastError && <Notice danger>上次运行出错：{stats.lastError}</Notice>}

        {(page === 'overview' || (page === 'resources' && model.resourceView === 'providers')) && model.taskActive && stats && (
          <JobMonitor stats={stats} collectionActive={model.collectionActive} validationActive={model.validationActive} fullCollectionStarting={model.fullCollectionStarting} validationStarting={model.validationStarting} activeSourceNames={model.activeSourceNames} validationStageLabel={model.validationStageLabel} validationPercent={model.validationPercent} onOpenLog={() => setPage('activity')} />
        )}
        {model.toast && <ActionToast toast={model.toast} onClose={() => model.setToast(null)} />}

        {page === 'overview' && stats && <DashboardPage stats={stats} gateway={gateway} validationActive={model.validationActive} validationStageLabel={model.validationStageLabel} validationPercent={model.validationPercent} collectionActive={model.collectionActive} fullCollectionActive={model.fullCollectionActive} onRun={model.startRun} onLocked={model.announceLockedAction} onNavigate={setPage} />}
        {page === 'groups' && <ProxyGroupsPage groups={model.groups} proxies={model.proxies} providers={model.providers} onSave={model.saveProxyGroup} onPatch={model.patchProxyGroup} onRemove={model.removeProxyGroup} />}
        {page === 'rules' && <RulesPage rules={model.rules} groups={model.groups} onSave={model.saveRoutingRule} onPatch={model.patchRoutingRule} onRemove={model.removeRoutingRule} />}
        {page === 'routing' && gateway && model.runtimeStatus && model.runtimeConfig && <GatewayPage gateway={gateway} runtimeStatus={model.runtimeStatus} runtimeConfig={model.runtimeConfig} onSaveRuntime={model.saveRuntime} onRuntimeAction={model.runRuntimeAction} copied={model.copied} routingSaving={model.gatewayRoutingSaving} routingError={model.gatewayRoutingError} profileOptions={model.gatewayProfileOptions} countryOptions={model.countryOptions} onCopy={model.copy} onSaveRouting={model.saveGatewayRouting} onReload={model.load} />}
        {page === 'connections' && gateway && <ConnectionsPage gateway={gateway} />}
        {page === 'resources' && <ResourcesPage view={model.resourceView} setView={model.setResourceView} pool={poolProps} providers={providerProps} providerCatalog={model.providers} onCreateProvider={async (provider) => { const value = await model.saveProvider(provider); await model.load(); return value; }} onPatchProvider={async (id, patch) => { const value = await model.patchProvider(id, patch); await model.load(); return value; }} onRefreshProvider={async (id) => { const value = await model.refreshProvider(id); await model.load(); return value; }} />}
        {page === 'diagnostics' && stats && <DiagnosticsPage stats={stats} gateway={gateway} gatewayProxy={model.gatewayDiagnosticProxy} mode={model.diagnosticMode} proxy={model.diagnosticProxy} targets={model.connectivityTargets} results={model.diagnosticMode === 'gateway' ? model.gatewayConnectivityResults : model.connectivityResults} checkedAt={model.diagnosticMode === 'gateway' ? model.gatewayConnectivityCheckedAt : model.connectivityCheckedAt} loading={model.diagnosticMode === 'gateway' ? model.gatewayConnectivityLoading : model.connectivityLoading} error={model.diagnosticMode === 'gateway' ? model.gatewayConnectivityError : model.connectivityError} onModeChange={(mode) => { model.setDiagnosticMode(mode); if (mode === 'gateway') void model.runGatewayDiagnostics(); else if (model.diagnosticProxy) void model.runConnectivity(model.diagnosticProxy); }} onRunGateway={model.runGatewayDiagnostics} onRunProxy={model.runConnectivity} browserSession={model.browserSession} browserDiagnosticLoading={model.browserDiagnosticLoading} browserDiagnosticError={model.browserDiagnosticError} onOpenBrowser={model.openBrowserDiagnostics} ipProfile={model.ipProfile} />}
        {page === 'activity' && stats && <ActivityPage stats={stats} control={control} lines={model.lines} />}
      </main>
    </div>
  );
}

export default function App() {
  return <ProxyManagerProvider><ProxyManagerApp /></ProxyManagerProvider>;
}
