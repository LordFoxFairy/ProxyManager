# ProxyManager

个人用的免费代理 IP 池:采集 → 校验 → 评分 → 取用,带 Tauri 桌面界面。

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
npm run dev serve            # HTTP API,默认 127.0.0.1:8787

# 桌面应用(会自动拉起后端)
cd ui && npm install && npm run tauri dev
```

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

tolerance 迟滞抄自 mihomo 的 url-test 组
(`adapter/outboundgroup/urltest.go`)。免费代理延迟波动极大(p50 1.5s /
p90 4.0s),不加迟滞会导致几乎每个请求都换节点,连接复用全废。

> ⚠️ 免费代理出口不可信,可能被中间人。只建议用于公开数据抓取,
> 不要走登录态或敏感流量。

## HTTP API

| 端点 | 说明 |
|---|---|
| `GET /proxy?https=true&scheme=socks5` | 取一个最优代理 |
| `GET /proxies?n=50&https=true` | 批量取 |
| `GET /stats` | 统计 |
| `GET /log` | 运行日志 |
| `POST /report?addr=1.2.3.4:1080&ok=false` | 回报真实使用结果 |
| `DELETE /proxy/{addr}` | 删除 |
| `POST /refresh?collect=true` | 立即跑一轮 |
| `GET /gateway` | 本地代理状态、当前节点、最近请求流 |
| `POST /gateway/strategy?strategy=round-robin` | 切换选择策略 |

用法示例:

```bash
PROXY=$(curl -s 'http://127.0.0.1:8787/proxy?https=true' | jq -r .url)
curl -x "$PROXY" https://example.com
# 用完回报结果,失败的代理会被快速淘汰
curl -X POST "http://127.0.0.1:8787/report?addr=${PROXY#*//}&ok=true"
```

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
- **没成功过的代理首次失败即淘汰。** 评分非对称:成功 +10、失败 −30,未验证过的
  失败直接归零。否则约 70% 的死代理会长期占用校验槽位。
- **`/report` 闭环。** 校验器测通 ≠ 业务能用(实测有 7/8 通过后仍在真实请求中失败的
  情况),所以消费方回报的权重高于校验本身(+15 / −40)。

## 配置

全部通过环境变量覆盖,见 `server/src/config.ts`:

`PM_DB`、`PM_PORT`、`PM_HOST`、`PM_TIMEOUT`、`PM_CONCURRENCY`、
`PM_COLLECT_INTERVAL`、`PM_RECHECK_INTERVAL`、`PM_VALIDATE_BATCH`

## 界面

配色与布局沿用 [cockpit-tools](https://github.com/jlcodes99/cockpit-tools)
的设计系统(CSS 变量):`--primary:#1d4ed8`、`--accent:#0ea5a5`、
蓝青渐变 `--gradient-primary`、Inter + JetBrains Mono、明暗双主题。
