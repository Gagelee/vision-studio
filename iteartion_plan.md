# Iteration Plan (Backend)

> 目的：把当前“前端 executor + Vite dev/preview middleware”的能力，升级为可上线、可后台持续跑、可审计/限流/重试的生产级 Agent & Asset Pipeline。

## 0. 现状摘要（2026-02-04）
- 前端：Director Console 产出 `AgentAction[]`，前端 executor 执行（编辑元素 + 资产生成），并在创建阶段展示生成进度。
- “后端”目前在 `vite.config.ts` 的中间件里：`/api/agent/*`、`/api/asset/image/generate`、`/__generated__/*`。
- 资产落盘到本地 `.vision-assets/` 并以 `/__generated__/...` 提供访问（适合本地，不适合线上）。
- 已实现：严格的资产生产顺序（KV → env → character → look → shot），失败会阻断下游；Environment/Casting/KV 均支持 variants + active 选定。
- Multi-agent 不再“静默降级到 single-call”：multi-agent 失败会返回 `HTTP 502` + `errorCode=MULTI_AGENT_FAILED`；前端提供 Retry / 显式 single-call fallback 的二次确认。
- 图片资产支持点击放大（Lightbox）。
- 可观测性增强：已加入 Agent registry + prompt version 标记 + LLM trace（含 usage）+ session token 统计（在 Debug 面板可视化）。
- 模型/网关策略（dev proxy）：文字 Agent（scaffold/direct）强制走 Compass；图片生成并发直连 Gemini + Compass 网关首个成功返回；Veo 视频生成强制直连 Gemini（不走 Compass）。
- Prompt 仍统一存放在 `lib/ai/prompts/*`，当前 registry/版本信息维护在 `lib/ai/promptMeta.ts`。
- 已发现稳定性问题（待治理）：
  - Scaffold 偶发返回截断 JSON（`response was not valid JSON`），需要后端增加结构化 repair/retry 与输出长度治理（token budget + schema slimming）。
  - 当前阶段流式事件（`trace`）只有状态元信息，缺少“每步可读摘要”；需要在每个 agent 完成时返回 `human_summary`，避免前端只能展示 JSON preview。
  - 提前进入项目后，若 shot keyframe 仍在生产，Stage 预览可能回落到 placeholder（已在 UI 侧通过“真实 keyframe 优先”策略缓解；仍建议补端到端回归用例）。
  - 3x3/2x2 contact-sheet 的细粒度 panel 信息未充分传递到 image2video：当前视频生成主要使用 shot-level prompt + source image，`panelBeats` 等分镜级结构未进入视频提示词编排，导致分镜丰富度利用不足。

## 0.1 可选迭代：Grid 拆分为独立 Keyframe（Shot Source 扩展）
- 目标：让 shot 的 keyframe source 同时支持两种输入形态：
  - 单张完整图片（现有模式）
  - 从 3x3 / 2x2 contact sheet 自动拆分出的单格图片（新模式）
- 数据模型建议：
  - 在 shot version metadata 记录 `sourceType: single | grid_panel`、`sourceGridId`、`panelIndex`、`panelBBox`、`panelCaption`。
  - 保留父级 grid 图引用，支持“回到原图”与可追溯关系。
- 处理流程建议：
  - 上传/生成 grid 后执行自动切图（按 3x3/2x2 规则 + 容错边界）。
  - 每个 panel 产出一个候选 keyframe version，继承父图公共描述（style/环境/角色约束）。
  - 若 panel 缺少单独描写：调用模型做 panel 理解（vision caption）并结合现有 story/shot/casting 信息组装可用描述。
  - 对每个 panel 生成 `video-ready prompt draft`，供 image2video 直接使用或轻编辑。
- 交互建议：
  - 在 Shot Editor 增加 “From Grid” 入口与 panel 选择器（多选导入）。
  - 支持一键“将全部 panel 生成为 variants”，并可指定哪些 panel 进入生产队列。
- 风险与约束：
  - 面板裁切精度与边框干扰（需要 gutter/边框检测与裁切后质量检查）。
  - 角色连续性约束（同一 grid 内多 panel 可能视角差异大，需避免误识别）。
  - 计算开销增加（切图 + caption + prompt assemble），需队列化与并发上限。

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
