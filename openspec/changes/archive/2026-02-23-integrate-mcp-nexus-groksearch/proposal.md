## Why

基于已解压后的真实代码，两个项目各自已经具备关键能力，但目前是割裂状态：

- `mcp-nexus` 已有成熟控制面能力：
  - `packages/bridge-server/src/app.ts`：`/mcp` 鉴权、全局/按 token 限流、会话传输。
  - `packages/bridge-server/src/tavily/keyPool.ts`：密钥轮询、额度预检、冷却与失效处理。
  - `packages/bridge-server/src/admin/routes.ts`：密钥/令牌/设置管理 API。
  - `packages/worker/src/app.ts`：云端 Worker 入口、`/health`、`/mcp`、`/admin/api` 与 Admin UI 路由。
- `GrokSearch` 已有成熟搜索执行能力：
  - `src/grok_search/server.py`：`web_search`、`get_sources`、`web_fetch`、`web_map`。
  - `web_search` 中并行 Grok + Tavily/Firecrawl 补源；`web_fetch` Tavily 失败后自动降级 Firecrawl。

当前痛点是：控制面与执行面分离、配置分散、部署链路不统一，无法形成“多 token 管理 + Grok/Tavily 搜索”的一体化系统。

## What Changes

- 以 `mcp-nexus` 为统一控制面，扩展为可管理 Grok token 池（不仅是现有 Tavily/Brave key）。
- 复用 `mcp-nexus` 既有限流、鉴权、会话与 Admin UI 框架，接入 `GrokSearch` 的搜索编排能力（Grok + Tavily + Firecrawl 兜底）。
- 新增 Grok 侧轮询与健康策略（借鉴 `TavilyKeyPool` 机制）：
  - 多 token 选择策略（轮询/随机）
  - 失败冷却与失效标记
  - 可观测的使用统计与错误审计
- 统一 MCP 工具面：在同一 `/mcp` 暴露 GrokSearch 能力，并保留现有工具治理能力（allowedTools、速率限制、管理员配置）。
- 统一部署基线：
  - Node + Docker Compose 作为主部署路径（沿用 `DEPLOYMENT.md`）
  - Cloudflare Worker 提供云端轻量部署路径与管理端对齐
  - dev/staging/prod 分层配置（Grok/Tavily/Firecrawl/管理密钥）

## Non-Goals

- 不重写 `GrokSearch` 的核心检索算法逻辑；优先做能力接入与治理统一。
- 不移除 `mcp-nexus` 现有 Tavily/Brave 工具链；本变更是在其上增加 GrokSearch 组合能力。

## Capabilities

### New Capabilities
- `grok-token-pool-management`: 在 `mcp-nexus` 中新增 Grok token 池管理、轮询、冷却、失效与恢复。
- `groksearch-pipeline-integration`: 集成 `web_search`/`get_sources`/`web_fetch`/`web_map` 到统一 MCP 入口。
- `unified-admin-control-plane`: 在现有 Admin API/UI 中增加 Grok 配置、模型策略、运行状态与审计可视化。
- `cloud-deployment-unification`: 提供 Node/Docker 与 Worker 的统一部署与配置规范。

### Modified Capabilities
- （无）当前 `openspec/specs/` 下尚无既有 capability 规范，本次以新增能力为主。

## Impact

- Affected code / systems:
  - `mcp-nexus`：`packages/bridge-server`、`packages/admin-ui`、`packages/db`、`packages/worker`。
  - `GrokSearch`（作为接入来源）：`src/grok_search/server.py`、`src/grok_search/providers/grok.py`、`src/grok_search/config.py`。
- APIs:
  - Admin API 新增 Grok token/模型与策略管理接口。
  - MCP `/mcp` 新增或扩展 GrokSearch 工具调用能力与统一响应约定。
- Dependencies:
  - 必选：Grok API（OpenAI 兼容端点）。
  - 可选：Tavily API、Firecrawl API（抓取与补源能力）。
- Delivery / Operations:
  - 统一密钥加密存储、限流、审计日志与健康检查。
  - 明确云端部署、配置注入、回滚与最小可观测性要求。
