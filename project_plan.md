# Shopee Vision Studio - 从交互 Demo 到可用本地项目（规划）

Last Updated: 2026-01-29

## 1. 项目概述

当前仓库是一个以 **Story → Sequence → Shot** 为核心的交互框架 Demo：UI 结构、关键模块（Stage / Inspector / Director Console / Asset Editor / Master Player）已具备雏形，但数据层仍以单一 `INITIAL_STORY` 为中心，缺少「Start Project / 项目管理层级 / 本地持久化 / 可落地的 Agent 流水线」等将 Demo 变为“可用项目”的关键能力。

本阶段目标：
- **先做本地项目（Local-first）**：项目可在本地创建/管理/保存/恢复，确保“直接跑起来、可持续迭代”。
- **主要计算与模型通过 API 完成**：前端负责流程编排、状态管理、交互与可控性；生成/解析/渲染等计算交给 API。
- **模型优先级明确且可切换**：默认使用 **Gemini** 做资产与推理；推理过程支持切换 **OpenAI / DeepSeek** 作为备选；所有 Agent 调用必须可配置（provider/model/temperature/baseUrl/debug），便于后期调试与对比。
- **短期不做多人协作**：单机单用户，聚焦体验闭环与工程底座。
- **以“一句话建片（One-sentence production）流水线”为主目标**：让用户“动动嘴巴就能导演片子”的爽感成立，同时具备结构化、可控、可回滚的工作流呈现。

## 2. 功能简述（现有能力 / 缺口）

### 2.1 已有能力（仓库现状）
- 交互骨架：Sidebar（层级导航）、Project Dashboard、Stage（Storyboard）、Shot Editor、Inspector（Shot 级参数）、Director Console（对话入口）、Master Player（播放容器）。
- 资产编辑：Environment / Character 的编辑器与基础 CRUD（当前仅在内存中生效）。
- Shot 版本：Shot 版本列表与切换（模拟生成 Variant），能更新内存状态。
- 主题与沉浸：Dark/Light、Cinema Mode（全屏）等展示能力。

### 2.2 关键缺口（从 Demo → 可用产品必须补齐）

| 能力域 | 现状 | 缺口描述（要变“可用”必须有） |
| --- | --- | --- |
| 项目管理层级 | 单项目、硬编码初始数据 | Workspace/Project 列表、创建/打开/重命名/删除/导入导出、最近使用 |
| Start Project | 无入口 | 启动页（无项目空态）、创建向导可达、可从项目库进入 |
| 持久化 | 无 | 本地存储（IndexedDB / localStorage）、schema 版本、迁移策略 |
| Sequence/Shot CRUD | 仅 UI，未接数据 | 新建 Sequence、增删改 Shot、排序移动、跨 Sequence 移动、级联校验 |
| 资产管理 | 有 UI 雏形 | 资产引用关系（Shot ↔ Character/Look ↔ Location）、继承/覆盖、锁定策略 |
| Agent 流水线 | Console 仅模拟回复 | “一句话建片”拆解为结构化步骤：Plan → Preview → Apply；任务进度、可撤销、可追溯 |
| API 对接 | 无 | API 协议与适配层、失败重试/降级、队列化任务（渲染/生成） |
| 工作流可控性 | 弱 | 操作日志、变更 diff、Undo/Redo、状态机（draft/locked/rendering/ready） |

## 3. 目标体验：一句话建片 + 结构化可控工作流

### 3.1 用户主路径（MVP）
1) 打开应用 → 看到 Project Library（无项目时有引导）  
2) 点击「Start Project」→ 输入一句话意图（Intent）+ 选择比例（AspectRatio 锁定）+（可选）KV  
3) 进入 **Scaffolding 流程**：Agent 将意图拆为结构化产物（Locations / Characters(+Looks) / Sequences / Shots）并逐步落盘  
4) 进入 Project Dashboard → Inspect Beats（Stage）查看结构  
5) 在 Shot 级 Inspector 做精修（Camera/Lighting/Casting/Script）  
6) 通过 Director Console 发号施令（对 Sequence 或 Shot）→ 以“结构化步骤 + 变更预览”呈现 → 一键应用  
7) 生成/迭代 Shot Image Version（调用 API；默认 Gemini / nano-banana-pro）→ Master Player 预览 Master Cut  
8) **视频生成不自动触发**：统一通过「Confirm Start Production」按钮开始生产（后续接入渲染/合成 API）

### 3.2 交互规范（关键约束）
- **对话只负责“意图输入”**，所有落地必须转成结构化 Action（可展示、可回滚）。
- **先 Plan 后 Apply**：Agent 产出步骤列表（actions），UI 展示影响范围与改动摘要，用户确认后再写入项目状态。
- **上下文清晰**：Console 必须明确“当前指令作用域”（Project / Sequence / Shot），并可切换。
- **可追溯与可撤销**：每次 Apply 生成一条 operation，支持 Undo（至少单步），并在日志中可回放。

### 3.3 Agent & Model 运行时原则（为调试而设计）
- **统一入口**：Scaffold / Direct / Generate 等能力走统一 Agent API（或本地 dev proxy），避免业务层散落调用不同厂商 SDK。
- **强可观测**：每次调用记录 provider/model/temperature、耗时、原始输出（可选），并能在 UI 中回看。
- **可降级**：当 API 不可用/输出不合规时，允许 fallback（mock / rule-based）保障流程可跑。

## 4. 项目计划（里程碑）

### M0 - 本地项目底座（Local Projects Foundation）
交付标准：能创建多个 Project、能关闭页面后恢复、能基本编辑并保存。
- Project Library（列表/最近打开/删除/重命名）
- Start Project 入口与创建向导可达
- 本地持久化（建议 IndexedDB；短期可先 localStorage 过渡）
- 数据 schema 版本 + 迁移框架（即便只有 v1 → v2，也要搭好）

### M1 - “一句话建片”Agent 流水线（Scaffolding Pipeline）
交付标准：一句话 + 比例 → 可生成结构化 Story，并把步骤与结果展示出来。
- 定义 Agent 输出结构：`Plan(steps[])` + `Artifacts(story)` + `Operations(diff)`
- 支持进度条与可中断（Cancel）
- 最小可用 API 对接（mock → 真 API），失败可重试/回退

### M2 - 工作流管理与可控性（Workflow Control）
交付标准：用户能在结构化层级上稳定编辑，不靠“写死数据”。
- Sequence/Shot 完整 CRUD + 排序/移动
- Undo/Redo（至少 1 级 Undo）+ 操作日志
- 渲染/生成任务队列（Shot Version 的生成从 UI 行为变成任务）

### M3 - 资产管理完善（Consistency Engine）
交付标准：资产可复用、可引用、继承逻辑清晰。
- Casting Look System 正式化（Character/Look 与 Shot 绑定）
- Environment/Location 继承到 Shot（Lighting/Style 的提示与覆盖）
- KV Anchor（Story 级 KV 槽位）与“同步到 Shot”的规则化

## 5. 预计补全内容（Backlog / vNext）

### 5.1 数据与工程
- 项目存储层：IndexedDB 封装、备份导出（JSON）、导入校验
- Schema 演进：字段变更与迁移策略、向后兼容（至少读旧写新）
- 测试与质量门槛：关键 reducer/store 测试、最小 e2e（可选）

### 5.2 Agent 能力
- 指令分类：Scaffold / Update / Reorder / Batch Edit / Generate
- 结构化动作类型（示例）：`CREATE_SEQUENCE`, `CREATE_SHOT`, `UPDATE_ELEMENT`, `SET_CAST`, `MOVE_SHOT`, `LOCK_ASPECT_RATIO`
- 变更预览：影响范围（哪些 shots / elements）、文本 diff、冲突提示

### 5.3 生成与预览
- Shot Version：从“随机图”替换为 API 回传资源（url/assetId）
- Master Cut：Sequence/Shot 拼接规则、过渡建议（后续）
- Export：最小导出（project JSON / 单帧下载 / 占位）

## 6. 工作拆分 Task（建议按迭代逐步完成）

> 下面以“最小可用闭环”为排序；每项尽量独立交付、可验收。

### Iteration 1：本地项目与入口（M0）
- [ ] 新增 Workspace / Project 数据模型（与现有 `Story` 关系：Story == Project 的内容层）
- [ ] 增加启动页：Project Library + Empty State（Start Project）
- [ ] 打通 ProjectCreationWizard 入口（从 Library 进入）
- [ ] 实现本地持久化（至少保存/载入/删除/重命名）
- [ ] 增加项目导出/导入（JSON），用于调试与备份

### Iteration 2：Scaffolding Agent（M1）
- [ ] 设计 API 协议（请求：intent/ratio/kv；响应：结构化 story + steps）
- [ ] Agent Plan UI：展示 steps、进度、可取消、失败重试
- [ ] Apply 机制：Plan → Preview → Apply（写入项目状态 + 记录 operation）

### Iteration 3：工作流可控与 CRUD（M2）
- [ ] Sequence CRUD：新建/重命名/删除（含级联 shots）
- [ ] Shot CRUD：新建/复制/删除/移动排序（Stage 内操作真实生效）
- [ ] Undo（至少 1 步）与操作日志面板（可选入口放在 Console 或 Inspector）
- [ ] Shot 生成任务队列：生成状态、排队、失败重试、结果写回版本列表

### Iteration 4：资产与一致性（M3）
- [ ] Casting/Looks 数据结构规范化（Shot 内仅存引用：characterId + lookId）
- [ ] Environment 继承/覆盖规则落地（Inspector 提示“继承自 Location/Story”）
- [ ] KV Anchor 与 Sync 行为规则化（Story KV → Shot 元素的映射）
