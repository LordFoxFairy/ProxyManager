# ProxyManager / Super Clash Verge

Super Clash Verge：兼容 Clash Verge 核心使用方式的统一代理客户端，覆盖系统代理、
规则路由、代理组、订阅 Provider、固定/长期 ISP 节点，并叠加动态代理池、服务能力检测、
IP 画像和浏览器环境诊断。

```
server/   Node + TypeScript 后端(采集/校验/存储/HTTP API)
ui/       Tauri 2 + React 19 桌面应用
```

## 快速开始

```bash
# 后端
cd server && npm install
npm run dev collect          # 采集候选(约 5,900 个)
npm run dev validate -n 700  # 校验
npm run dev get -n 10 --https
npm run dev serve            # API :8787 + 本地代理 :7899
npm test                     # 48 个单元测试

# 桌面应用(会自动拉起后端)
cd ui && npm install && npm run tauri dev
```

打包:

```bash
cd server && npm run bundle   # 编译 + 仅生产依赖(17MB,不是 53MB)
cd ../ui && npm run tauri build
```

打包版本依赖系统已安装 **Node.js** —— `better-sqlite3` 是原生模块,
打成单文件需要各平台预编译产物,对个人项目不划算。

## 本地代理端口(推荐用法)

不用写取用/回报的代码,直接把流量指过来即可 —— 轮换、失败重试、评分回写
全在端口后面自动完成(参考 Clash / mubeng / rota 的做法):

```bash
export https_proxy=http://127.0.0.1:7899
export http_proxy=http://127.0.0.1:7899
curl https://example.com

# 或单次
curl -x http://127.0.0.1:7899 https://example.com
```

默认端口 **7899**(刻意避开 Clash/mihomo 的 7890),**只监听回环地址** ——
绑到 `0.0.0.0` 等于给局域网开了个开放代理。

三种选择策略,可随时切换:

| 策略 | 行为 |
|---|---|
| `url-test`(默认) | 选最优节点,带 **tolerance 迟滞**:新节点必须快出 300ms 才换 |
| `round-robin` | 依次轮换,分摊请求 |
| `random` | 随机 |

```bash
curl -X POST "http://127.0.0.1:8787/gateway/strategy?strategy=round-robin"
curl -X POST "http://127.0.0.1:8787/gateway/strategy?tolerance=500&rotate_after=10"
```

本地端口还支持按用途和地区路由。可选用途包括智能识别、通用代理、OpenAI、
Claude Code、GitHub、Google、npm 和 YouTube。指定用途后优先选择已经通过该网站
连通性检测的代理;没有学习结果时先从地区匹配的 HTTPS 池中尝试,真实转发成功后
自动记住该代理的用途能力。

```bash
# OpenAI + 美国出口
curl -X PATCH http://127.0.0.1:8787/gateway/routing \
  -H 'content-type: application/json' \
  -d '{"profile":"openai","country":"US"}'

# 恢复智能识别 + 全部地区
curl -X PATCH http://127.0.0.1:8787/gateway/routing \
  -H 'content-type: application/json' \
  -d '{"profile":"auto","country":null}'
```

tolerance 迟滞抄自 mihomo 的 url-test 组
(`adapter/outboundgroup/urltest.go`)。免费代理延迟波动极大(p50 1.5s /
p90 4.0s),不加迟滞会导致几乎每个请求都换节点,连接复用全废。

> ⚠️ 免费代理出口不可信,可能被中间人。只建议用于公开数据抓取,
> 不要走登录态或敏感流量。

## HTTP API

| 端点 | 说明 |
|---|---|
| `GET /proxy?https=true&scheme=socks5` | 取一个最优代理 |
| `GET /proxies?page=1&page_size=50&https=true` | 分页查询代理池 |
| `GET /stats` | 统计 |
| `GET /log` | 运行日志 |
| `POST /report?addr=1.2.3.4:1080&ok=false` | 回报真实使用结果 |
| `DELETE /proxy/{addr}` | 删除 |
| `POST /refresh?collect=true` | 立即跑一轮 |
| `POST /collect` | 只更新所有已启用来源，不触发健康检查 |
| `GET /gateway` | 本地代理状态、当前节点、最近请求流 |
| `POST /gateway/connectivity` | 通过当前系统出口检测目标服务能力并保存结果 |
| `PATCH /gateway/routing` | 设置网关用途和出口地区 |
| `POST /gateway/strategy?strategy=round-robin` | 切换选择策略 |
| `GET /control` | 巡航参数、调度时间与采集源状态 |
| `PATCH /control` | 更新巡航开关、间隔和单轮校验量 |
| `PATCH /sources/{name}` | 启用或停用采集源 |
| `POST /sources/{name}/collect` | 立即运行指定采集源 |
| `GET /connectivity` | 获取默认连通性测试目标 |
| `POST /connectivity/check` | 通过代理池测试 HTTPS 目标 |
| `GET /proxy/{addr}/connectivity` | 读取指定代理的历史网站连通性结果 |
| `POST /proxy/{addr}/connectivity` | 通过指定代理测试 HTTPS 目标并保存结果 |
| `POST /diagnostics/browser/session` | 创建一次性默认浏览器诊断会话 |
| `GET /diagnostics/browser/{id}` | 打开本机浏览器诊断页 |
| `GET /diagnostics/browser/{id}/status` | 查询浏览器证据回传状态 |
| `GET /diagnostics/ip-profile?ip=...` | 查询出口 IP 的 ASN、组织和网络类型画像 |
| `GET /providers` | 订阅、固定节点和池 Provider 目录 |
| `POST /providers` | 创建 Provider |
| `PATCH /providers/{id}` | 更新 Provider 开关或节点 |
| `POST /providers/{id}/refresh` | 拉取并解析订阅 Provider |
| `GET /groups` | 代理组目录 |
| `POST /groups` | 创建代理组 |
| `PATCH /groups/{id}` | 修改代理组成员和策略 |

`GET /proxies` 支持 `scheme`、`https`、`country`、`anonymity`、
`min_score`、`target` 和 `search` 筛选。`target` 只返回对指定网站已有可用检测结果的
代理;`search` 同时匹配代理地址与实际出口 IP。响应包含 `total`、`page`、
`pageSize` 和 `totalPages`,用于服务端分页。

用法示例:

```bash
PROXY=$(curl -s 'http://127.0.0.1:8787/proxy?https=true' | jq -r .url)
curl -x "$PROXY" https://example.com
# 用完回报结果,失败的代理会被快速淘汰
curl -X POST "http://127.0.0.1:8787/report?addr=${PROXY#*//}&ok=true"
```

内置连通性目标包含 OpenAI API、Anthropic API、Google、YouTube、GitHub、
Cloudflare、npm 和 Wikipedia。连通性测试只展示目标能否经当前代理池到达,
不会修改代理评分。自定义目标仅接受公网域名形式的 HTTPS 地址。即使代理后来
失去 HTTPS 能力,仍可查看已经保存的历史结果。

## 实测数据与设计依据

所有结论均来自实测,并用 curl 独立复验(不只信自己的校验器)。

| 指标 | 实测值 |
|---|---|
| 采集候选(7 源去重后) | ~5,900 |
| 校验通过率 | ~30% |
| 延迟 p50 / p90 | 1.5s / 4.0s |

**socks4 是个陷阱。** 它占存活代理的一半以上,但只有约 **4%** 能建立
HTTPS CONNECT 隧道;socks5 约 **51%**。真实业务流量绝大多数是 HTTPS,所以
只看「可用总数」会高估池子实际能力约一倍 —— 界面因此把「支持 HTTPS」
作为一级指标,取用时建议始终带 `?https=true`。

几条影响实现的关键结论:

- **校验主体走 HTTP 而非 HTTPS。** CONNECT 隧道会隐藏匿名度检测所需的转发头,
  还会误判 SOCKS 代理。HTTPS 作为独立的第二次探测,只对已通过 HTTP 的代理执行。
- **回显端点必须多路 fallback。** httpbin.org 曾连续数小时 503,httpbingo.org
  一度返回 402。启动时逐个探测,全挂则**报错停止** —— 静默把所有代理误判成
  高匿比停机更糟。
- **回显服务自身注入的头要排除。** ifconfig.me / httpbingo 自己挂在代理后面,
  会带 `via`、`x-forwarded-for`;不排除的话每个代理都会被误判为 anonymous。
- **Node 的 `timeout` 只管套接字空闲,不是墙钟时间。** 曾观察到 8s 设置下实际
  跑了 26s。必须另加 `setTimeout` 硬截止,它同时充当质量过滤器。
- **批量失败先熔断。** 至少 50 条全失败,或 500 条以上通过率低于 0.5% 时,
  判定为回显链路/本机网络异常,整轮不写评分也不剔除。单点校验失败不能演变成
  全池清空。
- **没成功过的代理首次失败即淘汰。** 评分非对称:成功 +10、失败 −30,未验证过的
  失败直接归零。否则约 70% 的死代理会长期占用校验槽位。
- **`/report` 闭环。** 校验器测通 ≠ 业务能用(实测有 7/8 通过后仍在真实请求中失败的
  情况),所以消费方回报的权重高于校验本身(+15 / −40)。本地代理端口会自动完成
  这个回报,消费方无需关心。
- **死代理要立墓碑。** 免费列表两次刷新之间几乎不变,直接删除会导致同一批
  ~70% 的死代理每 30 分钟被重新采集、重新校验一遍,永远占着校验预算。
  墓碑按 1h → 2h → 4h(上限 24h)递增,期满才允许重试。
  实测:第二轮采集同样的 5,802 个地址,新增 **0**,314 个正确跳过。
- **自动剔除可控制。** 每轮校验结束后,评分归零且已经检测过的代理会从代理池删除,
  同时写入上述墓碑;桌面端可随时暂停或重新开启自动剔除。
- **隧道建立 ≠ 能用。** 死掉的 HTTP 代理照样回 `200 Connection Established`,
  然后在 TLS 握手时静默断开。网关会把客户端的 ClientHello 打过去、等真实回包,
  没回就换下一个 —— 这是 15s 超时变成 0.4s 成功的原因。

## 配置

### 发布桌面安装包

桌面端使用 Tauri 构建，跨平台发布由 GitHub Actions 负责。推送符合 `v*.*.*` 的 tag 后，
`.github/workflows/release.yml` 会自动构建 macOS（Apple Silicon 与 Intel）、Windows x64
和 Linux x64 安装包，并创建 GitHub Release 上传产物。发布前无需提交 `server/bundle`，CI
会先编译后端和生产依赖，再将其作为 Tauri 资源打包。

```bash
git tag v0.2.0
git push origin v0.2.0
```

首次启用前，请在仓库 Settings → Actions → General 中允许 workflow 创建 Release；生产环境
建议将 tag 保护规则和签名证书密钥配置到 GitHub Secrets。当前工作流默认生成未签名安装包，
macOS 用户可能需要在系统设置中允许首次打开。

全部通过环境变量覆盖,见 `server/src/config.ts`:

`PM_DB`、`PM_PORT`、`PM_HOST`、`PM_TIMEOUT`、`PM_CONCURRENCY`、
`PM_TCP_TIMEOUT`、`PM_TCP_CONCURRENCY`、
`PM_COLLECT_INTERVAL`、`PM_RECHECK_INTERVAL`、`PM_VALIDATE_BATCH`

桌面端修改的巡航参数和采集源开关会写入 SQLite 的 `app_settings` 表,
并覆盖对应的运行时默认值。

内置 **23 个**公共代理源,新数据库默认只开启其中 **7 个**推荐源,每个来源都能
独立启停和单独运行。除了纯文本列表外,采集器还支持站大爷国内/海外分页表格解析,
单次最多读取 5 页,避免无边界抓取。

## 界面

完整的产品边界、健康流水线、任务冲突矩阵和组件结构见
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；Super Clash Verge 的长期产品蓝图见
[SUPER_CLASH_VERGE_PLAN.md](SUPER_CLASH_VERGE_PLAN.md)。

界面采用固定浅色主题和高密度运维布局，按工作对象分为六页：

路由页已接入 Runtime 状态面板，可区分内置网关与 Mihomo、规则/全局/直连模式、配置版本、
系统代理和 TUN 能力；Mihomo 未配置时会明确显示降级原因。系统代理已接入 Tauri 平台命令，
TUN 已接入配置生成、设备探测和权限状态显示；实际创建虚拟网卡仍依赖各平台权限、驱动和 Mihomo 运行时。

| 页面 | 职责 |
|---|---|
| 总览 | 当前出口、池状态、任务进度与快捷操作 |
| 路由 | 本地监听、用途/地区策略、节点选择链路 |
| 连接 | 最近真实代理请求与转发结果 |
| 资源 | 节点与 Provider 两个页签，均使用分页 |
| 诊断 | 当前出口或指定节点的分层检测 |
| 活动 | 任务状态与运行日志 |

节点列表将代理地址与实际出口 IP 放在同一列，支持协议、HTTPS、评分、地区、匿名度、
IP 和网站能力筛选。点击节点打开独立 Inspector；浏览节点只读取历史结果，只有显式执行
“检测服务”或进入完整诊断才发起网络请求。Provider 页提供自动巡航、自动剔除、采集/复检
间隔、单轮校验量、23 个逐源开关和单源立即执行；同时可添加订阅、固定节点和长期 Provider。
Clash/Mihomo 订阅可保留 HTTP、SOCKS5、SS、VMess、VLESS、Trojan、Hysteria2、TUIC 和 WireGuard 等常见节点字段，
启用 Provider 的节点会与代理池节点一起编译进 Mihomo 代理组。

诊断分为基础健康、服务能力、IP 画像、泄漏与环境。当前已实现出口 IP、地区、协议、延迟、
基础健康证据，以及 OpenAI、Anthropic、GitHub 等目标服务检测；IP 画像通过 `ip-api` 获取
ASN、组织、ISP、代理/托管/移动标记。点击“打开浏览器诊断”会在默认浏览器运行一次性本机
页面，回传真实 IPv4/IPv6、WebRTC 候选、mDNS、时区、语言和 UA。DNS 泄漏仍需要配置唯一
域名回传服务，风险黑名单和多源情报属于后续 Provider；未接入能力不会生成虚假结果。
