# Iteration Plan (Backend)

> 目的：把当前“前端 executor + Vite dev/preview middleware”的能力，升级为可上线、可后台持续跑、可审计/限流/重试的生产级 Agent & Asset Pipeline。

## 0. 现状摘要（2026-02-04）
- 前端：Director Console 产出 `AgentAction[]`，前端 executor 执行（编辑元素 + 资产生成），并在创建阶段展示生成进度。
- “后端”目前在 `vite.config.ts` 的中间件里：`/api/agent/*`、`/api/asset/image/generate`、`/__generated__/*`。
- 资产落盘到本地 `.vision-assets/` 并以 `/__generated__/...` 提供访问（适合本地，不适合线上）。
- 已实现：严格的资产生产顺序（KV → env → character → look → shot），失败会阻断下游；Environment/Casting/KV 均支持 variants + active 选定。
- 可观测性增强：已加入 Agent registry + prompt version 标记 + LLM trace 基础（在 Debug 面板可视化）。
- Prompt 仍统一存放在 `lib/ai/prompts/*`，当前 registry/版本信息维护在 `lib/ai/promptMeta.ts`。

## 1. Backend 形态（BFF / Agent Gateway）
- 新建独立 Node 服务（可选：Express/Fastify/Hono），替代 `vite.config.ts` 的 API 中间件。
- 对外提供统一接口：
  - `POST /api/agent/scaffold`
  - `POST /api/agent/direct`
  - `POST /api/asset/image/generate`
  - `GET /assets/generated/:id`（或 CDN URL）
- 前端通过 `aiSettings.*.baseUrl` 指向该服务（本地可继续默认同源）。

## 2. 任务队列（核心）
- 引入 Job Queue（优先级、并发、重试、幂等）：
  - 轻量：BullMQ / Bee-Queue（Redis）
  - 或：Cloud provider queue（SQS / PubSub）
- 定义任务类型：
  - `scaffold_project`
  - `director_plan`
  - `generate_shot_image`
  - `generate_location_preview`
  - `generate_character_avatar`
  - `generate_character_look`
  - `generate_project_assets`（fan-out 到上面几类）
- 幂等策略：
  - `(model, aspectRatio, promptHash, storyId, shotId, versionTag)` 作为 dedupe key
  - 支持 `overwrite=false/true`

## 3. 状态与结果存储
- 存储 story + asset metadata（URL、hash、provider/model、cost、createdAt）：
  - DB：Postgres（推荐）/ SQLite（本地）
  - 对象存储：S3/GCS/OSS（图片/视频）
- 资产 URL：
  - 生成后上传对象存储，返回稳定 URL（带缓存头）
  - 前端保存 URL 到 story state；不再依赖本地 `.vision-assets`

## 4. 推送/进度
- 提供任务状态查询：
  - `GET /api/jobs/:jobId`
  - `GET /api/stories/:id/jobs`（最近任务）
- 推送方式：
  - SSE（优先，简单）或 WebSocket
- 前端：展示队列进度、失败原因、重试按钮（触发后端重试）。

## 5. 安全、成本与审计
- Key 全部只放后端（Gemini/OpenAI/DeepSeek 等）。
- Rate limit + concurrency limit（按用户/项目/组织）。
- 审计日志（prompt hash、模型、token、耗时、费用估算、失败栈）。
- 内容安全策略（可选）：敏感词、图像安全、版权/水印策略。

## 6. Prompt/工具协议演进
- 继续保持 `lib/ai/prompts/*` 为“单一来源”，后端读取同一套 prompt（或将 prompt 下沉为后端 package）。
- 扩展 `AgentActionType` 为“工具协议”，后端/前端共享 types：
  - Director 只产出 actions；Executor（后端）执行 actions 并回写 story。
- 引入版本化：
  - `promptVersion`、`actionSchemaVersion`

### 6.1 需求记录：Prompt Studio（UI 编辑/版本/diff/回滚）
> 目标：把 prompt 从“写在代码里”升级为“可在 UI 中运营/实验/回滚”，并且每一次 Agent/Asset 调用都可追溯到明确的 prompt 版本。

- UI 能力（前端为主，后端需承接存储/发布）：
  - 在 UI 中直接编辑各 agent prompt（包括资产生产 prompt），支持保存多版本（draft / published）。
  - 版本 diff（文本 diff），支持一键回滚到历史版本。
  - “当前运行版本”可选定（per-project override / global default），并能灰度（可选）。
- 运行时与审计（后端为主）：
  - 每次调用记录：`promptId`、`promptVersion`、prompt hash、provider/model、耗时、输出（可选）。
  - Prompt 发布链路需要鉴权（至少 dev 环境也要有 basic gate），并写审计日志。
  - Prompt 的存储形态建议：DB（Postgres/SQLite）+ Git/导出（可选双写）。

## 7. 迁移步骤（建议）
1) 把 `vite.config.ts` 的 `/api/asset/image/generate` 抽到独立 Node 服务（最小可用：仅图片生成 + 上传 + URL 返回）
2) 再抽 `/api/agent/scaffold`、`/api/agent/direct`
3) 引入队列，把“批量生成资产”从前端 executor 迁到后端 job（前端只发 `GENERATE_PROJECT_ASSETS`）
4) 引入 SSE 推送，前端用 jobId 跟踪进度
5) 增加幂等/去重/重试/限流/审计
