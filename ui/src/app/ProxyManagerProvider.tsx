import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  checkGatewayConnectivity,
  checkProxyConnectivity,
  collectAllSources,
  collectSource,
  getConnectivityTargets,
  getControl,
  getGateway,
  getLog,
  createBrowserDiagnosticSession,
  getBrowserDiagnosticStatus,
  getIpProfile,
  getRuntime,
  updateRuntime,
  runtimeAction,
  getProxies,
  getProxyConnectivity,
  getStats,
  refresh,
  removeProxy,
  updateControl,
  updateGatewayRouting,
  updateSource,
  type AutomationSettings,
  type BrowserDiagnosticSession,
  type ConnectivityResult,
  type ConnectivityTarget,
  type ControlState,
  type Gateway,
  type Proxy,
  type Stats,
  type RuntimeConfig,
  type RuntimeStatus,
} from '../lib/api';
import { invoke } from '@tauri-apps/api/core';
import type { SelectOption } from '../components/SelectMenu';
import type { Page, ResourceView, RunIntent, RunKind, ToastMessage } from './types';

const SOURCE_PAGE_SIZE = 8;

function readCustomTargets(): ConnectivityTarget[] {
  try {
    const value = JSON.parse(localStorage.getItem('pm-connectivity-targets') ?? '[]');
    return Array.isArray(value) ? value.slice(0, 6) : [];
  } catch {
    return [];
  }
}

function useProxyManagerState() {
  const [page, setPage] = useState<Page>('overview');
  const [resourceView, setResourceView] = useState<ResourceView>('nodes');
  const [stats, setStats] = useState<Stats | null>(null);
  const [gateway, setGateway] = useState<Gateway | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null);
  const [control, setControl] = useState<ControlState | null>(null);
  const [automationDraft, setAutomationDraft] = useState<AutomationSettings | null>(null);
  const [controlSaving, setControlSaving] = useState(false);
  const [controlError, setControlError] = useState('');
  const [proxies, setProxies] = useState<Proxy[]>([]);
  const [proxyTotal, setProxyTotal] = useState(0);
  const [proxyPage, setProxyPage] = useState(1);
  const [proxyPageSize, setProxyPageSize] = useState(50);
  const [proxyTotalPages, setProxyTotalPages] = useState(1);
  const [country, setCountry] = useState('');
  const [anonymity, setAnonymity] = useState('');
  const [minScore, setMinScore] = useState(1);
  const [targetFilter, setTargetFilter] = useState('');
  const [proxySearch, setProxySearch] = useState('');
  const [selectedProxy, setSelectedProxy] = useState<Proxy | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [offline, setOffline] = useState(false);
  const [onlyHttps, setOnlyHttps] = useState(false);
  const [scheme, setScheme] = useState('');
  const [copied, setCopied] = useState('');
  const [customTargets, setCustomTargets] = useState<ConnectivityTarget[]>(readCustomTargets);
  const [connectivityTargets, setConnectivityTargets] = useState<ConnectivityTarget[]>([]);
  const [connectivityResults, setConnectivityResults] = useState<Record<string, ConnectivityResult>>({});
  const [connectivityLoading, setConnectivityLoading] = useState(false);
  const [connectivityCheckedAt, setConnectivityCheckedAt] = useState<number | null>(null);
  const [connectivityError, setConnectivityError] = useState('');
  const [diagnosticProxy, setDiagnosticProxy] = useState<Proxy | null>(null);
  const [gatewayDiagnosticProxy, setGatewayDiagnosticProxy] = useState<Proxy | null>(null);
  const [gatewayConnectivityResults, setGatewayConnectivityResults] = useState<Record<string, ConnectivityResult>>({});
  const [gatewayConnectivityLoading, setGatewayConnectivityLoading] = useState(false);
  const [gatewayConnectivityCheckedAt, setGatewayConnectivityCheckedAt] = useState<number | null>(null);
  const [gatewayConnectivityError, setGatewayConnectivityError] = useState('');
  const [browserSession, setBrowserSession] = useState<BrowserDiagnosticSession | null>(null);
  const [browserDiagnosticLoading, setBrowserDiagnosticLoading] = useState(false);
  const [browserDiagnosticError, setBrowserDiagnosticError] = useState('');
  const [ipProfile, setIpProfile] = useState<import('../lib/api').IpProfile | null>(null);
  const [diagnosticMode, setDiagnosticMode] = useState<'gateway' | 'proxy'>('gateway');
  const [showTargetForm, setShowTargetForm] = useState(false);
  const [targetName, setTargetName] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [targetFormError, setTargetFormError] = useState('');
  const [sourcePage, setSourcePage] = useState(1);
  const [runIntents, setRunIntents] = useState<RunIntent[]>([]);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [gatewayRoutingSaving, setGatewayRoutingSaving] = useState(false);
  const [gatewayRoutingError, setGatewayRoutingError] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextStats, nextGateway, proxyResult, logResult, nextControl, nextRuntime] = await Promise.all([
        getStats(),
        getGateway(),
        getProxies({
          page: proxyPage,
          pageSize: proxyPageSize,
          https: onlyHttps,
          scheme: scheme || undefined,
          country: country || undefined,
          anonymity: anonymity || undefined,
          minScore,
          target: targetFilter || undefined,
          search: proxySearch.trim() || undefined,
        }),
        getLog(),
        getControl(),
        getRuntime(),
      ]);
      setStats(nextStats);
      setGateway(nextGateway);
      setRuntimeStatus(nextRuntime.status);
      setRuntimeConfig(nextRuntime.config);
      setProxies(proxyResult.proxies);
      setProxyTotal(proxyResult.total);
      setProxyPage(proxyResult.page);
      setProxyPageSize(proxyResult.pageSize);
      setProxyTotalPages(proxyResult.totalPages);
      setLines(logResult.lines);
      setControl(nextControl);
      setAutomationDraft((current) => current ?? nextControl.automation);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [anonymity, country, minScore, onlyHttps, proxyPage, proxyPageSize, proxySearch, scheme, targetFilter]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    void getConnectivityTargets()
      .then(({ targets }) => setConnectivityTargets([...targets, ...customTargets]))
      .catch(() => setConnectivityTargets(customTargets));
  }, []);

  const runConnectivity = useCallback(async (
    proxy: Proxy | null = selectedProxy,
    nextTargets?: ConnectivityTarget[],
  ) => {
    const targets = nextTargets ?? connectivityTargets;
    if (!proxy || !targets.length) return;
    setConnectivityLoading(true);
    setConnectivityError('');
    setConnectivityResults({});
    setConnectivityCheckedAt(null);
    try {
      const result = await checkProxyConnectivity(proxy.addr, targets);
      setConnectivityResults(Object.fromEntries(result.results.map((item) => [item.id, item])));
      setConnectivityCheckedAt(result.checkedAt);
      await load();
    } catch {
      setConnectivityError('该代理的连通性检测失败');
    } finally {
      setConnectivityLoading(false);
    }
  }, [connectivityTargets, load, selectedProxy]);

  const runGatewayDiagnostics = useCallback(async () => {
    if (!connectivityTargets.length) return;
    setGatewayConnectivityLoading(true);
    setGatewayConnectivityError('');
    setGatewayDiagnosticProxy(null);
    setGatewayConnectivityResults({});
    setGatewayConnectivityCheckedAt(null);
    try {
      const result = await checkGatewayConnectivity(connectivityTargets);
      setGatewayDiagnosticProxy(result.proxy);
      setGatewayConnectivityResults(Object.fromEntries(result.results.map((item) => [item.id, item])));
      setGatewayConnectivityCheckedAt(result.checkedAt);
      await load();
    } catch {
      setGatewayConnectivityError('当前网关出口的服务能力检测失败');
    } finally {
      setGatewayConnectivityLoading(false);
    }
  }, [connectivityTargets, load]);

  const openBrowserDiagnostics = useCallback(async () => {
    setBrowserDiagnosticLoading(true);
    setBrowserDiagnosticError('');
    try {
      const session = await createBrowserDiagnosticSession();
      setBrowserSession({ id: session.id, createdAt: Date.now(), expiresAt: session.expiresAt, state: 'pending', evidence: null });
      try { await invoke('open_external_url', { url: session.url }); }
      catch { window.open(session.url, '_blank', 'noopener,noreferrer'); }
    } catch {
      setBrowserDiagnosticError('浏览器诊断会话创建失败');
    } finally {
      setBrowserDiagnosticLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!browserSession || browserSession.state === 'complete') return;
    const timer = window.setInterval(() => {
      void getBrowserDiagnosticStatus(browserSession.id).then(setBrowserSession).catch(() => setBrowserDiagnosticError('浏览器诊断会话已失效'));
    }, 1200);
    return () => window.clearInterval(timer);
  }, [browserSession]);

  useEffect(() => {
    const ip = diagnosticMode === 'gateway' ? gatewayDiagnosticProxy?.exitIp : diagnosticProxy?.exitIp;
    if (!ip) { setIpProfile(null); return; }
    void getIpProfile(ip).then(setIpProfile).catch(() => setIpProfile(null));
  }, [diagnosticMode, diagnosticProxy?.exitIp, gatewayDiagnosticProxy?.exitIp]);

  useEffect(() => {
    setProxyPage(1);
    setSelectedProxy(null);
    setConnectivityResults({});
    setConnectivityCheckedAt(null);
  }, [anonymity, country, minScore, onlyHttps, proxyPageSize, proxySearch, scheme, targetFilter]);

  useEffect(() => {
    setSelectedProxy(null);
    setConnectivityResults({});
    setConnectivityCheckedAt(null);
  }, [proxyPage]);

  const copy = (value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(value);
    window.setTimeout(() => setCopied((current) => current === value ? '' : current), 1200);
  };

  const dropProxy = async (addr: string) => {
    await removeProxy(addr).catch(() => {});
    if (selectedProxy?.addr === addr) setSelectedProxy(null);
    await load();
  };

  const saveCustomTargets = (targets: ConnectivityTarget[]) => {
    setCustomTargets(targets);
    localStorage.setItem('pm-connectivity-targets', JSON.stringify(targets));
  };

  const addTarget = (event: FormEvent) => {
    event.preventDefault();
    const name = targetName.trim();
    try {
      const url = new URL(targetUrl.trim());
      const host = url.hostname.toLowerCase();
      if (
        !name || url.protocol !== 'https:' || url.username || url.password ||
        (url.port && url.port !== '443') || host === 'localhost' || host.endsWith('.local') ||
        !host.includes('.') || /^\d+(\.\d+){3}$/.test(host)
      ) throw new Error('invalid');
      if (customTargets.length >= 6) {
        setTargetFormError('最多添加 6 个自定义目标');
        return;
      }
      url.hash = '';
      const target: ConnectivityTarget = {
        id: `custom-${Date.now()}`,
        name: name.slice(0, 32),
        url: url.toString(),
      };
      const nextCustom = [...customTargets, target];
      const nextTargets = [...connectivityTargets, target];
      saveCustomTargets(nextCustom);
      setConnectivityTargets(nextTargets);
      setTargetName('');
      setTargetUrl('');
      setTargetFormError('');
      setShowTargetForm(false);
      void runConnectivity(selectedProxy, nextTargets);
    } catch {
      setTargetFormError('请输入名称和有效的公网 HTTPS 地址');
    }
  };

  const dropTarget = (id: string) => {
    const nextCustom = customTargets.filter((target) => target.id !== id);
    saveCustomTargets(nextCustom);
    setConnectivityTargets((targets) => targets.filter((target) => target.id !== id));
    setConnectivityResults((results) => {
      const next = { ...results };
      delete next[id];
      return next;
    });
  };

  const inspectProxy = (proxy: Proxy) => {
    setSelectedProxy(proxy);
    setConnectivityResults({});
    setConnectivityCheckedAt(null);
    setConnectivityError('');
    setShowTargetForm(false);
    void getProxyConnectivity(proxy.addr)
      .then((saved) => {
        setConnectivityResults(Object.fromEntries(saved.results.map((item) => [item.id, item])));
        setConnectivityCheckedAt(saved.checkedAt);
        if (!saved.results.length && !proxy.https) {
          setConnectivityError('该节点不支持 HTTPS，暂无服务能力历史');
        }
      })
      .catch(() => setConnectivityError('历史连通性结果读取失败'));
  };

  const openProxyDiagnostics = (proxy: Proxy) => {
    setDiagnosticMode('proxy');
    setDiagnosticProxy(proxy);
    setPage('diagnostics');
    setConnectivityResults({});
    setConnectivityCheckedAt(null);
    setConnectivityError('');
    if (proxy.https) void runConnectivity(proxy);
  };

  const openGatewayDiagnostics = () => {
    setDiagnosticMode('gateway');
    setPage('diagnostics');
    setGatewayDiagnosticProxy(null);
    setGatewayConnectivityResults({});
    setGatewayConnectivityCheckedAt(null);
    setGatewayConnectivityError('');
    void runGatewayDiagnostics();
  };

  const saveAutomation = async (settings = automationDraft) => {
    if (!settings) return;
    setControlSaving(true);
    setControlError('');
    try {
      const next = await updateControl(settings);
      setControl(next);
      setAutomationDraft(next.automation);
    } catch {
      setControlError('巡航设置保存失败');
    } finally {
      setControlSaving(false);
    }
  };

  const toggleAutomation = () => {
    if (!automationDraft) return;
    const next = { ...automationDraft, enabled: !automationDraft.enabled };
    setAutomationDraft(next);
    void saveAutomation(next);
  };

  const toggleAutoPurge = () => {
    if (!automationDraft) return;
    const next = { ...automationDraft, autoPurgeEnabled: !automationDraft.autoPurgeEnabled };
    setAutomationDraft(next);
    void saveAutomation(next);
  };

  const toggleSource = async (name: string, enabled: boolean) => {
    setControlError('');
    setControl((current) => current ? {
      ...current,
      sources: current.sources.map((source) => source.name === name ? { ...source, enabled } : source),
    } : current);
    try {
      setControl(await updateSource(name, enabled));
    } catch {
      setControlError('采集源状态更新失败');
      void load();
    }
  };

  const pushToast = (message: Omit<ToastMessage, 'id'>) => {
    setToast({ ...message, id: Date.now() });
  };

  const startRun = async (kind: RunKind, source?: string) => {
    const id = kind === 'source' ? `source:${source}` : kind;
    if (runIntents.some((intent) => intent.id === id)) return;
    const label = kind === 'source' ? `${source} 单源采集` : kind === 'collect' ? '全量采集' : '代理巡检';
    const intent: RunIntent = { id, kind, label, source, startedAt: Date.now() };
    setControlError('');
    setRunIntents((current) => [...current, intent]);
    pushToast({ tone: 'info', title: `${label}已启动`, detail: '状态会持续更新，任务结束后相关操作将自动恢复。' });
    try {
      if (kind === 'source' && source) await collectSource(source);
      else if (kind === 'collect') await collectAllSources();
      else await refresh(false);
      await load();
    } catch {
      setRunIntents((current) => current.filter((item) => item.id !== id));
      pushToast({ tone: 'danger', title: `${label}启动失败`, detail: '服务没有接受本次任务，请稍后重试或查看运行日志。' });
    }
  };

  const runSource = async (name: string) => startRun('source', name);

  const saveGatewayRouting = async (patch: { profile?: string; country?: string | null }) => {
    setGatewayRoutingSaving(true);
    setGatewayRoutingError('');
    try {
      await updateGatewayRouting(patch);
      await load();
    } catch {
      setGatewayRoutingError('用途路由保存失败');
    } finally {
      setGatewayRoutingSaving(false);
    }
  };

  const saveRuntime = async (patch: Partial<RuntimeConfig> & { kind?: 'builtin' | 'mihomo' }) => {
    const next = await updateRuntime(patch);
    setRuntimeStatus(next.status);
    setRuntimeConfig(next.config);
  };

  const runRuntimeAction = async (action: 'start' | 'stop' | 'restart') => {
    try {
      const next = await runtimeAction(action);
      setRuntimeStatus(next.status);
    } catch (error) {
      setControlError(error instanceof Error ? error.message : 'Runtime 操作失败');
      await load();
    }
  };

  const resetProxyFilters = () => {
    setScheme('');
    setOnlyHttps(false);
    setCountry('');
    setAnonymity('');
    setMinScore(1);
    setTargetFilter('');
    setProxySearch('');
  };

  const runningSources = control?.sources.filter((source) => source.running) ?? [];
  const collectionJob = stats?.jobs.collection;
  const validationJob = stats?.jobs.validation;
  const sourceIntentNames = runIntents.filter((intent) => intent.kind === 'source' && intent.source).map((intent) => intent.source!);
  const activeSourceNames = [...new Set([
    ...runningSources.map((source) => source.name),
    ...(collectionJob?.sources ?? []),
    ...sourceIntentNames,
  ])];
  const fullCollectionActive = Boolean(collectionJob?.full || runIntents.some((intent) => intent.kind === 'collect'));
  const fullCollectionStarting = runIntents.some((intent) => intent.kind === 'collect') && !collectionJob?.full;
  const collectionActive = Boolean(collectionJob?.running || activeSourceNames.length || fullCollectionActive);
  const validationActive = Boolean(validationJob?.running || runIntents.some((intent) => intent.kind === 'validate'));
  const validationStarting = runIntents.some((intent) => intent.kind === 'validate') && !validationJob?.running;
  const taskActive = collectionActive || validationActive;
  const validationStageLabel = validationJob?.stage === 'tcp'
    ? 'TCP 探活'
    : validationJob?.stage === 'proxy'
      ? '协议与出口验证'
      : validationJob?.stage === 'geo'
        ? '地区补全'
        : '准备检查';
  const validationPercent = validationJob?.total ? Math.round((validationJob.completed / validationJob.total) * 100) : 0;
  const announceLockedAction = (title: string, detail: string) => pushToast({ tone: 'info', title, detail });
  const countryOptions: SelectOption[] = [
    { value: '', label: '全部地区' },
    ...Object.keys(stats?.byCountry ?? {}).filter((value) => value !== '?').sort().map((value) => ({ value, label: value })),
  ];
  const targetOptions: SelectOption[] = [
    { value: '', label: '全部网站' },
    ...connectivityTargets.map((target) => ({ value: target.id, label: `${target.name} 可用` })),
  ];
  const gatewayProfileOptions: SelectOption[] = gateway?.profiles.map((profile) => ({ value: profile.id, label: profile.name })) ?? [];
  const sourceTotalPages = Math.max(1, Math.ceil((control?.sources.length ?? 0) / SOURCE_PAGE_SIZE));
  const visibleSources = control?.sources.slice(
    (Math.min(sourcePage, sourceTotalPages) - 1) * SOURCE_PAGE_SIZE,
    Math.min(sourcePage, sourceTotalPages) * SOURCE_PAGE_SIZE,
  ) ?? [];

  useEffect(() => {
    setSourcePage((current) => Math.min(current, sourceTotalPages));
  }, [sourceTotalPages]);

  useEffect(() => {
    if (!runIntents.length || !stats || !control) return;
    const completed = runIntents.filter((intent) => {
      if (intent.kind === 'source') {
        const source = control.sources.find((item) => item.name === intent.source);
        return Boolean(source && !source.running && (source.lastRun ?? 0) >= intent.startedAt);
      }
      if (intent.kind === 'collect') {
        return !collectionJob?.full && (collectionJob?.fullLastCompletedAt ?? collectionJob?.lastCompletedAt ?? 0) >= intent.startedAt;
      }
      return !validationJob?.running && (validationJob?.lastCompletedAt ?? 0) >= intent.startedAt;
    });
    if (!completed.length) return;
    const intent = completed[completed.length - 1]!;
    const error = intent.kind === 'validate'
      ? validationJob?.lastError
      : intent.kind === 'collect'
        ? collectionJob?.lastError
        : control.sources.find((source) => source.name === intent.source)?.lastError;
    pushToast({
      tone: error ? 'danger' : 'success',
      title: error ? `${intent.label}已中止` : `${intent.label}已完成`,
      detail: error
        ? '检测到异常批量失败，代理池保持不变；详情已写入运行日志。'
        : intent.kind === 'validate'
          ? '代理健康状态、出口能力和运行日志已经更新。'
          : '来源候选与采集统计已经更新。',
    });
    const completedIds = new Set(completed.map((item) => item.id));
    setRunIntents((current) => current.filter((item) => !completedIds.has(item.id)));
  }, [collectionJob, control, runIntents, stats, validationJob]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 4600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return {
    page, setPage, resourceView, setResourceView, stats, gateway, runtimeStatus, runtimeConfig, saveRuntime, runRuntimeAction, control, automationDraft, setAutomationDraft, controlSaving,
    controlError, proxies, proxyTotal, proxyPage, setProxyPage, proxyPageSize, setProxyPageSize,
    proxyTotalPages, country, setCountry, anonymity, setAnonymity, minScore, setMinScore,
    targetFilter, setTargetFilter, proxySearch, setProxySearch, selectedProxy, setSelectedProxy,
    lines, offline, onlyHttps, setOnlyHttps, scheme, setScheme, copied, connectivityTargets,
    connectivityResults, connectivityLoading, connectivityCheckedAt, connectivityError,
    diagnosticProxy, gatewayDiagnosticProxy, diagnosticMode, setDiagnosticMode,
    gatewayConnectivityResults, gatewayConnectivityLoading, gatewayConnectivityCheckedAt,
    gatewayConnectivityError,
    browserSession, browserDiagnosticLoading, browserDiagnosticError, openBrowserDiagnostics, ipProfile,
    showTargetForm, setShowTargetForm, targetName, setTargetName, targetUrl, setTargetUrl,
    targetFormError, setTargetFormError, sourcePage, setSourcePage, toast, setToast,
    gatewayRoutingSaving, gatewayRoutingError, load, runConnectivity, runGatewayDiagnostics,
    openProxyDiagnostics, openGatewayDiagnostics, copy, dropProxy, addTarget,
    dropTarget, inspectProxy, saveAutomation, toggleAutomation, toggleAutoPurge, toggleSource,
    startRun, runSource, saveGatewayRouting, resetProxyFilters, activeSourceNames,
    fullCollectionActive, fullCollectionStarting, collectionActive, validationActive,
    validationStarting, taskActive, validationStageLabel, validationPercent, announceLockedAction,
    countryOptions, targetOptions, gatewayProfileOptions, sourceTotalPages, visibleSources,
  };
}

type ProxyManagerContextValue = ReturnType<typeof useProxyManagerState>;
const ProxyManagerContext = createContext<ProxyManagerContextValue | null>(null);

export function ProxyManagerProvider({ children }: { children: ReactNode }) {
  return <ProxyManagerContext.Provider value={useProxyManagerState()}>{children}</ProxyManagerContext.Provider>;
}

export function useProxyManager() {
  const value = useContext(ProxyManagerContext);
  if (!value) throw new Error('useProxyManager must be used inside ProxyManagerProvider');
  return value;
}
