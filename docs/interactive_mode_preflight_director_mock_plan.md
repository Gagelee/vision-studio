# Interactive Mode: Preflight + Director Console 交互与 Mock 测试方案

## 1. 目标

本文件用于两件事：

1. 统一梳理 `interactive mode` 下，`preflight` 和 `director console` 的真实交互与用户需求。
2. 形成可直接执行的 mock 测试用例与流程（前端真实走 UI + mock API），用于回归异步编排、任务跟踪、前后端状态一致性。

范围以当前代码为准：
- `/Users/jiazhi.li/work/shopee-vision-studio---aigc-director/components/Stage/ProjectCreationWizard.tsx`
- `/Users/jiazhi.li/work/shopee-vision-studio---aigc-director/App.tsx`
- `/Users/jiazhi.li/work/shopee-vision-studio---aigc-director/components/Console/DirectorConsole.tsx`
- `/Users/jiazhi.li/work/shopee-vision-studio---aigc-director/lib/preflight/referenceAssignment.ts`

## 2. 交互总览（Interactive Mode）

主链路：
1. 用户在创建页切到 `Interaction`。
2. 点击 `Start Interaction` 后进入 preflight 聊天（而不是直接 scaffold）。
3. preflight 内可上传附件、分配附件目标（global/character/location/unassigned）。
4. preflight 导演对话沉淀 brief，用户 `Force Start` 后才进入 scaffold。
5. 在 Director Console 中继续对话；若是 interaction 模式，生成动作会被延迟。
6. 系统弹出 `Interaction Mode Confirmation`（Generate Now / Modify In Chat / Upload Refs First）。
7. 只有用户确认 `Generate Now`，才真正触发资产生成任务。

关键设计意图：
- 交互优先澄清，不默认立刻生成。
- 参考图必须可追踪（谁上传、绑定给谁、何时进入生成上下文）。
- 延迟生成必须有显式确认，避免误触发成本。

## 3. Preflight 可能交互与用户需求

### 3.1 用户可能动作

1. 首次进入 preflight，空消息 kickoff，让导演先问澄清问题。
2. 上传 1~N 张参考图。
3. 调整每张附件的 `assignedTo`：
- `global`
- `character:<name>`
- `location:<name>`
- `unassigned`
4. 连续多轮对话，反复修正目标。
5. `Force Start` 进入 scaffold。
6. 退出 preflight（未进入生产）并期待聊天记录被清理。
7. 从 `interaction` 切回 `auto`，preflight 应强制关闭并清理会话。

### 3.2 用户需求（产品语义）

1. 澄清优先：先确认需求，再生产。
2. 参考图绑定可控：可以明确绑定到角色/场景。
3. 绑定结果可透传：scaffold 后落到 story/character/location 的 `referenceImages`。
4. 可中断可重来：退出 preflight 不应污染下一次会话。
5. UI 稳定：输入框、附件区、聊天区不互相遮挡。

### 3.3 当前实现关键点

1. preflight 只在 interaction 模式下开启。
2. 切回 auto 会触发 `closePreflight({ clearSession: true })`。
3. `Force Start` 会把 preflight brief + assignment 摘要拼入 intent。
4. scaffold 返回后调用 `applyPreflightReferenceAssignments`，把绑定写回实体。
5. `unassigned` 当前不会自动绑定到角色/场景（仅记录，不进入 global/char/loc 注入）。

## 4. Director Console 可能交互与用户需求

### 4.1 用户可能动作

1. 普通文本指令（改剧情、改 cast、改场景、改镜头）。
2. 在 console 上传附件。
3. 不同 selection 下发送消息：
- story 级
- character 级
- location 级
- shot 级
4. interaction 模式下发出会触发生成的指令。
5. 在 pending confirmation 期间继续发送新指令（会清掉旧 pending）。
6. multi-agent 失败后重试（可选 single fallback）。

### 4.2 用户需求（产品语义）

1. 附件要“就近挂载”：根据 selection 自动挂到当前上下文。
2. interaction 模式下不要直接生成，要先给候选摘要+二次确认。
3. 用户可以在确认前继续修改，系统应清理旧待执行队列，避免串单。
4. 失败要有可恢复路径（retry/fallback），并保留任务可观察性。

### 4.3 当前实现关键点

1. Console 附件会先读为 dataURL，再通过 selection 绑定到 story/character/location referenceImages。
2. interaction 模式会给 director 指令前缀：
- 先澄清
- 先提候选
- 未确认前不执行生成
3. `applyDirectorActions(..., { deferGeneration: true })` 会把生成任务转为 `pendingInteractionGeneration`。
4. 确认弹窗提供三选：
- `Generate Now`
- `Modify In Chat`
- `Upload Refs First`

## 5. 真实 Mock 用例矩阵（建议首批）

### 5.1 Preflight

1. `PF-01` kickoff 空消息
- 期望：出现 system seed + agent 澄清问句；`preflightReady` 仅在确认后成立。

2. `PF-02` 附件绑定 global
- 期望：scaffold 后 story 级 `referenceImages` 有数据。

3. `PF-03` 附件绑定 character/location
- 期望：scaffold 后对应实体有 `referenceImages`，且 `referenceMode=auto`。

4. `PF-04` unassigned 行为
- 期望：不应错误注入角色/场景；UI 可见 assignment 但不污染实体绑定。

5. `PF-05` 中途退出
- 期望：未进入生产时关闭 preflight，聊天记录/附件/brief 清空。

6. `PF-06` interaction -> auto 切换
- 期望：preflight 强制关闭并清 session。

### 5.2 Director Console（interaction）

1. `DC-01` 纯文本改 cast（SET_CAST）
- 期望：story 结构更新；若涉及生成动作则进入 pending confirmation。

2. `DC-02` 上传附件 + character selection
- 期望：附件挂到该角色 referenceImages。

3. `DC-03` 上传附件 + location selection
- 期望：附件挂到该场景 referenceImages。

4. `DC-04` pending confirmation 期间继续发消息
- 期望：旧 pending 被清理，新的指令生效。

5. `DC-05` 选择 Generate Now
- 期望：真正触发 asset jobs，任务中心出现 queued/running，并最终 done/error。

6. `DC-06` 选择 Modify In Chat / Upload Refs First
- 期望：不触发生成，仅清 pending 并给 toast 提示。

### 5.3 失败与回退（mock API）

1. `FB-01` 图像主通道失败，fallback 成功
- 期望：任务最终 success，debug 里有 attemptedTransports 轨迹。

2. `FB-02` 全通道失败
- 期望：任务 failed，错误文案可追溯。

3. `FB-03` 队列压力
- 期望：burst 场景下任务不丢失，状态可从 queued -> running -> success/failed 完整流转。

## 6. 前端真实 Mock 测试流程

## 6.1 启动

1. 安装依赖并启动前端：
```bash
npm install
npm run dev
```

2. 在 AI Settings 里把相关模型切到 mock-sim（建议）：
- direct: `provider=gemini`, `model=mock-sim-*`
- scaffold planner/worker: `mock-sim-scaffold-planner` / `mock-sim-scaffold-worker`
- image: `mock-sim-image`

说明：这样仍走真实异步 pipeline，只是模型响应由 mock-sim 驱动。

## 6.2 接口健康与脚本回归（建议每轮先跑）

```bash
npm run check:api
npm run debug:iteration
npm run debug:iteration -- --include-scaffold
npm run debug:image:fallback
```

## 6.3 UI 实操回归（核心）

1. 创建新项目，切 `Interaction`。
2. 执行 preflight 用例 `PF-01 ~ PF-06`。
3. 进入项目后在 Director Console 执行 `DC-01 ~ DC-06`。
4. 同时打开 Task Center 检查：
- asset/casting/production 分类下是否出现对应任务
- 状态是否终态收敛

## 6.4 用 mock API 注入失败（可选）

可通过脚本直接验证 fallback：
```bash
npm run debug:image:fallback
```

若需要手工 API 注入，可向 `/api/asset/image/generate` 提交 `debugMock`：
- `enableDualChannel`
- `forceFailTransports`
- `forceAllTransportsFail`

## 7. 每条用例必须记录的观测点（建议模板）

1. 输入：用户指令、selection、是否有附件、附件 assign 目标。
2. 行为：是否出现 pending confirmation，是否触发真实生成。
3. 数据：
- story/character/location 的 referenceImages 变化
- shot assetState / production 状态迁移
- pipelineTaskId/statusUrl 是否保留到终态
4. 展示：Task Center 行是否正确分类与收敛。
5. 结论：Pass/Fail + root cause。

## 8. 判定标准（DoD）

1. interaction 模式下生成动作都需显式确认后执行。
2. preflight 与 console 附件绑定都可追踪，且落地到正确实体。
3. 失败/重试/fallback 有可观测任务轨迹，不出现“丢任务”。
4. 前端不出现“已完成但仍 queued/running”的长期漂移状态。
5. 回归矩阵（PF/DC/FB）全部通过后，方可合入主干。
