# Super Clash Verge 产品蓝图

## 1. 产品定义

ProxyManager 的最终目标是 **Super Clash Verge**：

```text
Clash Verge 的完整桌面代理体验
+ Mihomo / sing-box 运行时
+ 订阅与配置管理
+ 代理组与规则路由
+ 动态代理池
+ 长期 ISP / 住宅节点
+ 服务能力与浏览器环境诊断
```

它不是把代理池页面做得更大，而是把所有代理资源统一接入一个长期运行的客户端。

## 2. 用户心智模型

用户只需要理解四个对象：

| 对象 | 用户问题 | 系统责任 |
|---|---|---|
| Provider | 节点从哪里来 | 拉取、解析、更新、过期、质量统计 |
| 节点 | 我有哪些可用出口 | 统一协议、地区、ISP、健康和能力信息 |
| 代理组 | 这次流量怎么选节点 | 手动、自动、延迟、地区、用途、故障转移 |
| 规则 | 哪些流量走哪个组 | 域名、进程、IP、GeoIP、Final 策略 |

底层的 Mihomo、订阅转换、池节点评分和探针属于实现细节，不应迫使用户在页面之间来回理解。

## 3. 总体架构

```text
┌─────────────────────────────────────────────┐
│ UI Shell                                     │
│ 总览 / 代理组 / Provider / 规则 / 连接 / 诊断 │
└──────────────────────┬──────────────────────┘
                       │ typed control API
┌──────────────────────▼──────────────────────┐
│ Control Plane                                │
│ 配置编排 / Provider / 节点目录 / 策略 / 任务   │
└───────────────┬──────────────────┬───────────┘
                │                  │
┌───────────────▼──────┐ ┌─────────▼──────────┐
│ Runtime Adapter       │ │ Intelligence       │
│ Mihomo / sing-box     │ │ 探活 / 能力 / IP /  │
│ 系统代理 / TUN / DNS  │ │ 真实流量反馈        │
└───────────────┬──────┘ └─────────┬──────────┘
                │                  │
                └──────────┬───────┘
                           ▼
                    SQLite + 事件日志
```

### 3.1 Runtime Adapter

Runtime 是唯一负责接管系统流量的层。UI 不直接操作进程、端口或 TUN。

统一接口至少包含：

```ts
interface RuntimeAdapter {
  install(): Promise<void>;
  start(config: RuntimeConfig): Promise<void>;
  stop(): Promise<void>;
  restart(config: RuntimeConfig): Promise<void>;
  status(): Promise<RuntimeStatus>;
  setSystemProxy(enabled: boolean): Promise<void>;
  setTun(enabled: boolean): Promise<void>;
  logs(): AsyncIterable<RuntimeEvent>;
}
```

第一阶段优先接 Mihomo，因为它与 Clash Verge 配置和代理组模型兼容；sing-box 作为第二个
Runtime Adapter，而不是把两个内核逻辑混在 UI 里。

### 3.2 Control Plane

Control Plane 生成 Runtime 配置，负责：

- 将 Provider 节点转换成统一节点目录。
- 将代理组和规则编译成 Mihomo/sing-box 配置。
- 追踪当前生效配置版本和回滚版本。
- Runtime 重启失败时保留旧配置，不破坏用户当前网络。
- 将 Runtime 连接事件回写到节点能力和评分系统。

## 4. 统一节点模型

Provider 节点和动态池节点必须统一成一个逻辑模型，但生命周期不能混用。

```ts
type NodeKind = 'fixed' | 'subscription' | 'isp' | 'residential' | 'pool';

interface Node {
  id: string;
  name: string;
  kind: NodeKind;
  providerId: string;
  protocol: 'http' | 'socks5' | 'ss' | 'vmess' | 'vless' | 'trojan' | 'hysteria2' | 'tuic' | 'wireguard';
  endpoint: string;
  country: string | null;
  region: string | null;
  isp: string | null;
  sessionPolicy: 'rotating' | 'sticky' | 'fixed' | null;
  health: 'healthy' | 'degraded' | 'ejected' | 'cooling' | 'unchecked';
  capabilities: Record<string, CapabilityState>;
  expiresAt: number | null;
  lastUsedAt: number | null;
}
```

### 生命周期规则

| 节点类型 | 失败处理 | 更新处理 |
|---|---|---|
| pool | 评分、临时摘除、指数退避 | 采集器可重新发现 |
| fixed | 标记异常，不自动删除 | 用户显式修改 |
| subscription | 标记失效，保留引用 | Provider 更新时增删改 |
| isp/residential | 结合余额、到期、会话状态 | Provider/API 更新 |

## 5. Provider 设计

Provider 是资源入口，不等同于现在的公共采集 Source。统一类型：

```ts
type ProviderKind =
  | 'clash-subscription'
  | 'sing-box-subscription'
  | 'yaml-file'
  | 'json-file'
  | 'fixed-node'
  | 'isp-api'
  | 'residential-api'
  | 'public-pool';
```

每个 Provider 必须有：

- 启用状态和独立更新周期。
- 最近更新、下次更新、耗时、错误和节点变化摘要。
- 解析版本和原始快照，支持回滚。
- 限速、超时、重试和熔断。
- 节点删除策略：从订阅消失不等于用户手动节点删除。
- Provider 级健康趋势，而不是只显示当前节点数量。

ISP/住宅 Provider 额外支持：

- 国家/城市/ASN/运营商筛选。
- sticky session / rotating session。
- 用户名、密码、API Token 的安全存储。
- 余额、配额、到期时间和请求失败原因。
- 连接前不在日志中暴露完整凭据。

## 6. 代理组模型

代理组是运行时真正消费节点的地方。一个代理组可以混合固定节点、订阅节点、ISP 节点和池节点。

```ts
type GroupKind = 'select' | 'url-test' | 'fallback' | 'load-balance' | 'smart';

interface ProxyGroup {
  id: string;
  name: string;
  kind: GroupKind;
  members: GroupMember[];
  targetProfile: string | null;
  country: string | null;
  excludeKinds: NodeKind[];
  toleranceMs: number;
  intervalSeconds: number;
  persistSelection: boolean;
}
```

默认组建议：

```text
PROXY
├── 手动选择
├── 自动选择
├── 故障转移
├── OpenAI
├── Claude
├── ISP 长期
├── 美国
├── 新加坡
└── DIRECT
```

“自动选择”只是组策略，不是另一个独立节点池。它根据健康、目标能力、地区、会话策略和真实
流量反馈排序。服务能力失败只降低目标组权重，不修改节点基础健康。

## 7. 规则模型

规则分为用户可编辑规则和系统生成规则：

```text
用户规则
  -> 应用/进程规则
  -> 域名规则
  -> GeoIP / IP-CIDR
  -> 私有地址与局域网
  -> Final
```

规则编辑器必须支持：

- 命中顺序和冲突预览。
- 单条规则测试：输入域名/IP/进程，显示最终代理组。
- 导入 Clash 规则集和远程 Rule Provider。
- 变更预览、校验、应用、回滚。
- 规则更新失败时继续使用上一版本。

## 8. 诊断与智能调度

诊断分为四层，不能混成一个总分：

1. 基础健康：TCP、协议、出口、TLS、延迟。
2. 服务能力：OpenAI、Claude、GitHub、流媒体等目标。
3. IP 画像：国家、ASN、ISP、住宅/IDC/移动、代理和风险标记。
4. 浏览器环境：IPv4/IPv6、DNS、WebRTC、mDNS、时区、语言和 UA。

调度输入必须标明证据来源：主动探针、真实连接、用户手动指定。缺少证据时使用未知状态，
不能用默认分数冒充可用。

## 9. 页面规划

最终页面建议调整为：

```text
总览      当前运行状态、系统代理/TUN、活动代理组、异常
代理组    手动/自动选择、延迟、地区、用途和组成员
Provider  订阅、固定节点、ISP、住宅、公共池
规则      模式切换、规则编辑、命中测试和 Rule Provider
连接      实时连接、进程、目标、规则、节点和耗时
诊断      四层诊断、浏览器会话、历史证据
活动      任务、Runtime 日志、配置版本和错误详情
设置      Runtime、端口、DNS、更新、凭据和数据目录
```

现有 `资源` 页面可作为过渡页，但 Runtime 接入后应拆成 `代理组`、`Provider` 和 `规则`，
避免把长期运行控制和资源采集塞在同一个页面。

## 10. 分阶段交付

### Phase 0：当前基础

- 动态代理池、Provider 开关、TCP-first 健康流水线。
- 目标服务能力和路由策略。
- 浏览器诊断会话和 IP 画像。

### Phase 1：Runtime 基础

- Mihomo sidecar 生命周期管理。
- 配置生成、校验、版本和回滚。
- 本地 HTTP/SOCKS/Mixed 端口状态。
- 系统代理开关和托盘状态。

验收：系统浏览器通过 ProxyManager 出口访问，关闭应用后系统代理恢复原状态。

### Phase 2：Provider 与节点目录

- Clash YAML/JSON 订阅导入。
- 手动节点和固定 ISP 节点。
- 节点统一模型和来源详情。
- Provider 更新、快照、回滚、错误状态。

验收：导入一个订阅与一个池 Provider，节点可在同一代理组中混合选择。

### Phase 3：代理组

- select、url-test、fallback、load-balance。
- 目标能力、地区和 ISP 类型筛选。
- 手动选择持久化和自动选择迟滞。

验收：OpenAI 组、美国组和 ISP 长期组可独立选择，组切换不修改 Provider 数据。

### Phase 4：规则与 TUN

- Rule Provider、规则编辑、命中测试。
- 全局/规则/直连模式。
- TUN、DNS、FakeIP、IPv6 策略。
- macOS/Windows/Linux 权限和失败恢复。

验收：系统应用按规则分流，Runtime 重启或配置错误不会造成系统代理失控。

### Phase 5：智能运维

- 连接事件回流。
- 被动异常检测和临时摘除。
- Provider 质量趋势、节点成本和 ISP 配额。
- SSE 事件流、任务历史和配置审计。

验收：代理组能基于目标能力和真实连接结果自动调整，同时所有决策可追溯。

## 11. 不可妥协的工程约束

- UI 不直接实现 Runtime 协议；所有 Runtime 通过 Adapter。
- Provider 更新、健康检查、服务能力检测和真实连接反馈相互独立。
- 任何配置应用前先校验，失败保留旧版本。
- 系统代理/TUN 变更必须可恢复，并记录原始状态。
- 凭据进入系统安全存储，不写 SQLite 明文和运行日志。
- 诊断结果必须带时间戳、对象、来源和过期时间。
- 大列表必须服务端分页；长任务必须可取消、可观察、可追溯。
- 兼容 Clash 配置时优先保持语义兼容，不承诺所有私有扩展 1:1 兼容。

## 12. 当前下一步

下一步不是继续增加采集源，而是建立 `RuntimeAdapter`、`Provider`、`Node`、`ProxyGroup`、
`RuleSet` 五个后端契约，先用内置 HTTP 网关做兼容实现，再接入 Mihomo sidecar。这样现有
代理池可以继续工作，同时后续的系统代理、TUN、订阅和自由选组不会重复造数据模型。
