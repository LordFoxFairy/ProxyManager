import type { Dispatch, SetStateAction } from 'react';
import { Boxes, Check, ChevronLeft, ChevronRight, Copy, Filter, Lock, Network, Search, Trash2 } from 'lucide-react';
import { Empty, SchemeBadge, Score } from '../../components/Pieces';
import { SelectMenu, type SelectOption } from '../../components/SelectMenu';
import type { ConnectivityResult, ConnectivityTarget, Proxy } from '../../lib/api';
import { NodeInspector } from './NodeInspector';

const SCHEME_OPTIONS: SelectOption[] = [
  { value: '', label: '全部协议' }, { value: 'socks5', label: 'socks5' },
  { value: 'socks4', label: 'socks4' }, { value: 'http', label: 'http' },
];
const ANONYMITY_OPTIONS: SelectOption[] = [
  { value: '', label: '全部匿名度' }, { value: 'elite', label: 'elite' },
  { value: 'anonymous', label: 'anonymous' }, { value: 'transparent', label: 'transparent' },
];
const SCORE_OPTIONS: SelectOption[] = [
  { value: '1', label: '评分 >= 1' }, { value: '40', label: '评分 >= 40' },
  { value: '60', label: '评分 >= 60' }, { value: '80', label: '评分 >= 80' },
];
const PAGE_SIZE_OPTIONS: SelectOption[] = [
  { value: '25', label: '25' }, { value: '50', label: '50' }, { value: '100', label: '100' },
];

export interface ProxyPoolPageProps {
  offline: boolean;
  proxies: Proxy[];
  proxyTotal: number;
  proxyPage: number;
  proxyPageSize: number;
  proxyTotalPages: number;
  proxySearch: string;
  scheme: string;
  country: string;
  anonymity: string;
  minScore: number;
  targetFilter: string;
  onlyHttps: boolean;
  onlyExitIp: boolean;
  countryOptions: SelectOption[];
  targetOptions: SelectOption[];
  selectedProxy: Proxy | null;
  connectivityTargets: ConnectivityTarget[];
  connectivityResults: Record<string, ConnectivityResult>;
  connectivityLoading: boolean;
  connectivityCheckedAt: number | null;
  connectivityError: string;
  copied: string;
  setProxySearch: (value: string) => void;
  setScheme: (value: string) => void;
  setCountry: (value: string) => void;
  setAnonymity: (value: string) => void;
  setMinScore: (value: number) => void;
  setTargetFilter: (value: string) => void;
  setOnlyHttps: (value: boolean) => void;
  setOnlyExitIp: (value: boolean) => void;
  setProxyPage: Dispatch<SetStateAction<number>>;
  setProxyPageSize: (value: number) => void;
  setSelectedProxy: (value: Proxy | null) => void;
  resetFilters: () => void;
  runConnectivity: (proxy: Proxy) => Promise<void>;
  inspectProxy: (proxy: Proxy) => void;
  openDiagnostics: (proxy: Proxy) => void;
  onLocked: (title: string, detail: string) => void;
  copy: (value: string) => void;
  dropProxy: (addr: string) => Promise<void>;
}

export function ProxyPoolPage(props: ProxyPoolPageProps) {
  const {
    offline, proxies, proxyTotal, proxyPage, proxyPageSize, proxyTotalPages, proxySearch,
    scheme, country, anonymity, minScore, targetFilter, onlyHttps, onlyExitIp, countryOptions, targetOptions,
    selectedProxy, connectivityTargets, connectivityResults, connectivityLoading,
    connectivityCheckedAt, connectivityError, copied, setProxySearch, setScheme, setCountry,
    setAnonymity, setMinScore, setTargetFilter, setOnlyHttps, setOnlyExitIp, setProxyPage, setProxyPageSize,
    setSelectedProxy, resetFilters, runConnectivity, inspectProxy, openDiagnostics, onLocked, copy, dropProxy,
  } = props;

  return (
    <div className={`pool-page${selectedProxy ? ' inspector-open' : ''}`}>
      <div className="pool-workspace">
        <div className="pool-filterbar">
          <div className="pool-search"><Search size={14} /><input aria-label="搜索代理 IP" placeholder="搜索代理或出口 IP" value={proxySearch} onChange={(event) => setProxySearch(event.target.value)} /></div>
          <SelectMenu label="协议筛选" value={scheme} options={SCHEME_OPTIONS} onChange={setScheme} className="filter-scheme" />
          <SelectMenu label="地区筛选" value={country} options={countryOptions} onChange={setCountry} searchable searchPlaceholder="搜索国家代码" className="filter-country" />
          <SelectMenu label="匿名度筛选" value={anonymity} options={ANONYMITY_OPTIONS} onChange={setAnonymity} className="filter-anonymity" />
          <SelectMenu label="最低评分" value={String(minScore)} options={SCORE_OPTIONS} onChange={(value) => setMinScore(Number(value))} className="filter-score" />
          <SelectMenu label="服务能力筛选" value={targetFilter} options={targetOptions} onChange={setTargetFilter} className="filter-target" />
          <div className="pool-filter-actions">
            <label className="filter-check"><input type="checkbox" checked={onlyHttps} onChange={(event) => setOnlyHttps(event.target.checked)} /><span><Lock size={12} /> HTTPS</span></label>
            <label className="filter-check"><input type="checkbox" checked={onlyExitIp} onChange={(event) => setOnlyExitIp(event.target.checked)} /><span><Network size={12} /> 有出口</span></label>
            <button className="btn btn-icon" title="清除筛选" onClick={resetFilters}><Filter size={14} /></button>
            <span className="pool-total">{proxyTotal.toLocaleString()} 条</span>
          </div>
        </div>

        <div className="pool-table-panel">
          {proxies.length === 0 ? (
            <Empty icon={<Boxes size={34} />} title="没有符合条件的节点" hint={offline ? '后端未连接' : '调整筛选条件或更新 Provider'} action={<button className="btn" onClick={resetFilters}><Filter size={15} />清除筛选</button>} />
          ) : (
            <div className="table-wrap">
              <table className="proxy-table">
                <thead><tr><th className="col-endpoint">节点 / 出口 IP</th><th className="col-scheme">协议</th><th className="col-score">评分</th><th className="col-latency">延迟</th><th className="col-https">HTTPS</th><th className="col-connectivity">服务能力</th><th className="col-anonymity">匿名度</th><th className="col-country">地区</th><th className="col-source">Provider</th><th className="col-actions" /></tr></thead>
                <tbody>{proxies.map((proxy) => (
                  <tr key={proxy.addr} className={selectedProxy?.addr === proxy.addr ? 'selected' : ''} onDoubleClick={() => inspectProxy(proxy)}>
                    <td className="col-endpoint"><button className="proxy-identity-button" onClick={() => inspectProxy(proxy)}><strong>{proxy.addr}</strong><span>出口 {proxy.exitIp ?? '—'}</span></button></td>
                    <td className="col-scheme"><SchemeBadge scheme={proxy.scheme} /></td>
                    <td className="col-score"><Score value={proxy.score} /></td>
                    <td className="mono col-latency">{proxy.latencyMs ? `${proxy.latencyMs}ms` : '—'}</td>
                    <td className="col-https"><span className={`badge ${proxy.https ? 'badge-yes' : 'badge-no'}`}>{proxy.https ? '可用' : '不可'}</span></td>
                    <td className="col-connectivity"><button className="probe-trigger" onClick={() => inspectProxy(proxy)}>{proxy.connectivity ? <span className={`probe-summary${proxy.connectivity.available === proxy.connectivity.total ? ' complete' : ''}`}>{proxy.connectivity.available}/{proxy.connectivity.total}</span> : <span className="probe-pending">未检测</span>}</button></td>
                    <td className="muted col-anonymity">{proxy.anonymity ?? '—'}</td><td className="mono col-country">{proxy.country ?? '—'}</td><td className="muted col-source" title={proxy.source ?? undefined}>{proxy.source ?? '—'}</td>
                    <td className="col-actions"><div className="proxy-row-actions"><button className="btn btn-icon" title="查看节点" onClick={() => inspectProxy(proxy)}><Network size={14} /></button><button className="btn btn-icon" title="复制代理地址" onClick={() => copy(proxy.url)}>{copied === proxy.url ? <Check size={14} /> : <Copy size={14} />}</button><button className="btn btn-icon" title="删除节点" onClick={() => void dropProxy(proxy.addr)}><Trash2 size={14} /></button></div></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div className="pagination-bar"><span>第 {proxyPage} / {proxyTotalPages} 页</span><span>每页</span><SelectMenu label="每页数量" value={String(proxyPageSize)} options={PAGE_SIZE_OPTIONS} onChange={(value) => setProxyPageSize(Number(value))} compact className="page-size-menu" /><span className="grow" /><button className="btn btn-icon" title="上一页" disabled={proxyPage <= 1} onClick={() => setProxyPage((value) => value - 1)}><ChevronLeft size={15} /></button><div className="page-numbers">{Array.from({ length: Math.min(5, proxyTotalPages) }, (_, index) => { const start = Math.max(1, Math.min(proxyPage - 2, proxyTotalPages - 4)); const value = start + index; return <button className={value === proxyPage ? 'active' : ''} key={value} onClick={() => setProxyPage(value)}>{value}</button>; })}</div><button className="btn btn-icon" title="下一页" disabled={proxyPage >= proxyTotalPages} onClick={() => setProxyPage((value) => value + 1)}><ChevronRight size={15} /></button></div>
        </div>
      </div>

      {selectedProxy && <NodeInspector proxy={selectedProxy} targets={connectivityTargets} results={connectivityResults} loading={connectivityLoading} checkedAt={connectivityCheckedAt} error={connectivityError} onClose={() => setSelectedProxy(null)} onRun={() => runConnectivity(selectedProxy)} onDiagnostics={() => openDiagnostics(selectedProxy)} onCopy={() => copy(selectedProxy.url)} onLocked={() => onLocked('该节点不支持服务检测', '目标服务检测需要节点具备 HTTPS 转发能力；基础健康和历史结果仍可查看。')} />}
    </div>
  );
}
