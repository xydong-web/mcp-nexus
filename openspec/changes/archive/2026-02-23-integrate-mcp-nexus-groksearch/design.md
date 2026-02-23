## Context

当前目标是在不推翻现有两套实现的前提下，把 `GrokSearch` 的执行能力并入 `mcp-nexus` 的控制面与部署体系，形成统一的 MCP 服务。

现状约束（来自已落地代码）：

- 控制面已在 `mcp-nexus` 完整存在：
  - `packages/bridge-server/src/app.ts` 已实现 `/mcp` 鉴权、全局/按 token 限流、会话传输与 Admin API 挂载。
  - `packages/bridge-server/src/admin/routes.ts` 已实现 key/token 的增删改查、reveal 限流、审计日志、服务设置读写。
  - `packages/bridge-server/src/settings/serverSettings.ts` 已有服务级策略持久化（`searchSourceMode`、`tavilyKeySelectionStrategy`、`researchEnabled`）。
  - `packages/worker/src/mcp/mcpHandler.ts` 已有工具白名单（`allowedTools`）和按模式路由（`tavily_only`/`brave_only`/`combined`/fallback）。
- 上游 key 池治理语义已成熟：
  - `packages/bridge-server/src/tavily/keyPool.ts` 提供可复用模式：轮询/随机候选、额度预检、冷却/失效、刷新锁与过期缓存回退。
- `GrokSearch` 已有可复用执行能力：
  - `GrokSearch-grok-with-tavily/src/grok_search/server.py` 提供 `web_search`、`get_sources`、`web_fetch`、`web_map`。
  - `GrokSearch-grok-with-tavily/src/grok_search/providers/grok.py` 提供流式请求、重试、Retry-After 处理与模型可用性校验。

关键利益相关方：

- 平台管理员：希望在单一 Admin 入口统一管理 token/key、路由策略、审计与可观测。
- MCP 客户端调用方：希望在同一 `/mcp` 下稳定调用 GrokSearch 能力，且继续受限流和工具治理保护。
- 运维侧：希望 Node/Docker 与 Worker 部署路径保持一致的配置语义和回滚方式。

## Goals / Non-Goals

**Goals:**

- 将 GrokSearch 能力并入 `mcp-nexus` 的统一 MCP 面：在保留现有 Tavily/Brave 工具的同时，新增 GrokSearch 工具族并可被 `allowedTools` 控制。
- 在 `mcp-nexus` 中新增 Grok token 池治理，语义对齐现有 `TavilyKeyPool`：
  - 可配置选择策略（轮询/随机）。
  - 失败冷却、鉴权失效标记、可恢复激活。
  - 最小可观测（使用日志、失败原因、审计事件）。
- 统一控制面配置：Grok 模型、搜索组合策略、补源策略（Tavily/Firecrawl 是否启用与配额）进入服务设置与 Admin API。
- 给出可执行的迁移方案：先并行引入 GrokSearch 能力，再逐步默认化，不中断现有 Tavily/Brave 调用链。

**Non-Goals:**

- 不重写 `GrokSearch` 内部检索与提示工程策略（例如 `search_prompt`、URL ranking 细节）。
- 不替换现有 `mcp-nexus` Tavily/Brave 工具；本次是增量集成，不是能力迁移或废弃。
- 不在本变更中引入新的外部搜索供应商（超出 Grok/Tavily/Firecrawl/Brave 组合）。
- 不在本变更中重构 Admin UI 的整体设计系统，仅新增必要配置与状态面板。

## Decisions

### 1) 以 `mcp-nexus` 为唯一控制平面，GrokSearch 作为执行能力内嵌

**Decision**

- 继续以 `packages/bridge-server/src/app.ts` 的 `/mcp` 作为唯一入口，不暴露独立 GrokSearch 服务给终端客户端。
- 在 `createCombinedProxyServer` 现有注入模式上扩展 Grok provider，使鉴权、限流、工具白名单、会话语义保持一致。

**Rationale**

- 现有控制能力（`validateClientToken`、`FixedWindowRateLimiter`、`allowedTools`）已经成熟，复用成本最低。
- 避免双入口导致的策略漂移（一个入口有审计/限流，另一个没有）。

**Alternatives considered**

- 方案 A：保留独立 GrokSearch 进程，通过 bridge 转发。缺点：部署拓扑更复杂、故障域增加、配置重复。
- 方案 B：直接在 Worker 侧先落 Grok 全能力。缺点：与现有 Node Admin 控制面割裂，首次集成可观测性弱。

### 2) 新增 Grok key/token 池，机制镜像 `TavilyKeyPool`

**Decision**

- 引入 `GrokKey`（或等价命名）数据模型与 `GrokKeyPool` 运行时组件，沿用 `TavilyKeyPool` 成熟机制：
  - 候选 key 选择：复用 `orderKeyCandidates` + 策略枚举（`round_robin` / `random`）。
  - 状态机：`active` / `cooldown` / `invalid` / `disabled`。
  - 失败处理：401/403 → `invalid`，429/上游限流 → `cooldown`。
  - 并发保护：刷新锁/互斥语义，避免并发请求集中击穿单 key。

**Rationale**

- `packages/bridge-server/src/tavily/keyPool.ts` 已验证可行，直接复用策略可降低实现风险。
- Grok provider (`providers/grok.py`) 已有可重试行为，池层只需处理 key 生命周期和选择。

**Alternatives considered**

- 方案 A：仅单一 Grok key，不做池化。缺点：可用性差、不可平滑轮换。
- 方案 B：完全依赖 provider 重试，不做 key 状态。缺点：无法对坏 key 做快速隔离。

### 3) MCP 工具面按“原子工具 + 编排工具”双层建模

**Decision**

- 在 MCP 层新增 GrokSearch 工具族，保持与 `GrokSearch` 对齐：`web_search`、`get_sources`、`web_fetch`、`web_map`。
- 同时保留现有 Tavily/Brave 工具，允许 token 通过 `ClientToken.allowedTools` 精准控制可调用集合。
- 对于 `web_search` 的“Grok + Tavily/Firecrawl 补源”逻辑，作为单工具内部编排暴露，不要求客户端感知多上游。

**Rationale**

- 与现有 `handleToolCall` 的前缀路由模式一致，接入成本低。
- 单工具编排可减少客户端编排复杂度，并将失败回退策略集中在服务端统一治理。

**Alternatives considered**

- 方案 A：仅暴露 Grok 原子能力，客户端自行串联。缺点：客户端复杂且难统一审计。
- 方案 B：把补源拆为多个 MCP 步骤。缺点：调用时延上升，状态管理复杂（如 source session）。

### 4) 服务设置扩展而非新增独立配置中心

**Decision**

- 复用 `ServerSetting` + `ServerSettings` 缓存/失效机制，增加 Grok 相关配置键：
  - `grokModelDefault`
  - `grokKeySelectionStrategy`
  - `grokExtraSourcesDefault`
  - `firecrawlEnabled`
  - `grokSearchEnabled`
- 通过 `admin/routes.ts` 的 `GET/PATCH /server-info` 或新增并列 endpoint 暴露这些配置。

**Rationale**

- 现有 `ServerSettings` 已有 in-flight 去重 + TTL 缓存，直接扩展可减少热路径 DB 压力。
- Admin API 保持一致风格，前端改造最小。

**Alternatives considered**

- 方案 A：引入单独配置表。缺点：重复轮子，增加迁移和维护负担。
- 方案 B：全部走环境变量。缺点：无法运行时变更，也不利于多环境灰度。

### 5) 数据模型采用“与 Tavily/Brave 平行”策略

**Decision**

- 在 `packages/db/prisma/schema.prisma` 增加 Grok 平行模型（命名可在实现阶段定稿）：
  - `GrokKey`：加密存储、mask、状态、`lastUsedAt`、`failureScore`、时间戳。
  - `GrokToolUsage`：toolName、outcome、latency、clientToken 关联、query hash/preview、errorMessage。
- 复用现有 `AuditLog` 记录关键管理操作（create/update/delete/reveal/refresh）。

**Rationale**

- 现有 `TavilyKey`/`BraveKey`/`TavilyToolUsage`/`BraveToolUsage` 结构已证明可支撑治理与排障。
- 平行模型便于查询与权限边界清晰，不与 Tavily 语义耦合。

**Alternatives considered**

- 方案 A：复用 TavilyKey 表加 provider 字段。缺点：字段含义混杂，后续扩展成本高。
- 方案 B：仅审计不记录 usage。缺点：缺乏性能与质量回归依据。

### 6) 部署策略：Node 主路径先行，Worker 能力对齐逐步补齐

**Decision**

- 第一阶段以 Node bridge (`DEPLOYMENT.md` 现有主路径) 承载完整 GrokSearch 集成。
- Worker 侧沿 `packages/worker/src/mcp/mcpHandler.ts` 现有模式补齐基础兼容（至少工具暴露、allowedTools、rate limit、关键错误映射一致），复杂编排可后置。

**Rationale**

- Node 侧已有最完整的 key 池与 Admin 管理实现，能够最快形成可运营闭环。
- Worker 先保证协议兼容，降低首发风险。

**Alternatives considered**

- 方案 A：Node 与 Worker 同步全量实现。缺点：首发周期长、测试面倍增。

## Risks / Trade-offs

- [Risk] Grok 上游限流或抖动导致整体请求成功率下降  
  → Mitigation: 池化 + 冷却机制；按错误码区分 `invalid` 与 `cooldown`；在编排层对补源路径设置超时与降级。

- [Risk] `web_search` 编排引入额外时延（Grok + Tavily/Firecrawl 并发/回退）  
  → Mitigation: 设定分层超时、并发上限与 early-return 策略；为耗时工具单独统计 `latencyMs`。

- [Risk] 工具面扩展后 `allowedTools` 配置错误造成误放权  
  → Mitigation: 默认最小权限模板；Admin UI 选择器仅允许已注册工具名；服务端二次校验。

- [Risk] 数据迁移增加运维复杂度（新增表与索引）  
  → Mitigation: Prisma migration 分阶段发布；先创建表再灰度写入；提供回滚 migration。

- [Risk] Node 与 Worker 行为短期不完全一致  
  → Mitigation: 明确兼容矩阵，先保证协议与错误码一致；将高级编排能力标记为 Node-first。

## Migration Plan

1. **Schema 迁移**
   - 在 `packages/db/prisma/schema.prisma` 增加 Grok key/usage 模型及必要索引。
   - 生成并应用 migration；不影响现有 Tavily/Brave 表。

2. **控制面能力落地（Node）**
   - 新增 Grok key pool、rotating client、Admin routes（CRUD/reveal/status）。
   - 扩展 `ServerSettings` 与 `/server-info` 配置键。

3. **MCP 工具接入**
   - 在 combined proxy/tool registry 注册 GrokSearch 工具。
   - 确保 `allowedTools`、限流、审计和 usage log 在新工具上生效。

4. **灰度发布**
   - 默认关闭 `grokSearchEnabled`；仅对测试 token 放开工具。
   - 观察错误率、时延、key 冷却/失效率后再扩大范围。

5. **Worker 对齐**
   - 对齐工具声明、路由开关和核心错误映射。
   - 在后续迭代补齐与 Node 同等级编排能力。

6. **Rollback 策略**
   - 配置级回滚：关闭 `grokSearchEnabled`，移除 token 的 Grok 工具权限。
   - 代码级回滚：回退到不注册 Grok 工具的版本；保留新增表不影响旧路径。

## Open Questions

- Grok 模型默认值是否固定为单模型，还是允许按 token 覆盖（类似 default_parameters header 语义）？
- `web_search` 的 `session_id` 与 `get_sources` 缓存应仅驻留内存，还是需要持久化以支持多实例/重启恢复？
- Firecrawl 在生产环境是否默认启用，还是仅作为可选补源插件（涉及成本与合规）？
- Worker 侧 Grok 集成的目标等价级别（协议兼容 vs. 全编排等价）在本 change 周期内要求到哪一层？
- Admin UI 是否需要展示“按 provider 的成功率/延迟看板”，还是先以 usage logs 导出能力满足运维需求？