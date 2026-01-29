# Shopee Vision Studio: 创意迭代与新洞察 (TryIdea)

> 此文档用于记录与专业导演（商业广告、市场营销领域）交流后的核心洞察，并探讨如何将这些行业痛点转化为产品功能。

---

## 💡 核心洞察 (New Insights)

### 1. Key Visual (KV) 的统治地位
**导演反馈**：在商业视频中，KV（主视觉）不是一张简单的图，它是整个项目的“视觉宪法”。所有的色彩、构图比例、材质感都必须以此为锚点。
*   **痛点**：目前 AIGC 视频往往每一组镜头看起来都很美，但缺乏一个统一的“视觉一致性锚点”。
*   **产品化思路**：
    *   **KV 锚定系统**：允许导演上传或生成一张“Master KV”，系统自动提取其色彩空间（LUTs）、构图张力和光影风格，并将其作为“强约束”注入到后续所有镜头生成中。
    *   **Moodboard 实时引用**：在执导面板中，KV 应始终处于悬浮可见状态，确保创作不偏离主线。

### 2. 后期编辑 (Editing) 的叙事节奏
**导演反馈**：拍得好不如剪得好。剪辑决定了叙事的节奏感（Pacing）、呼吸感和情绪转换。
*   **痛点**：对于不懂剪辑的初学者，处理素材的入点（In-point）和出点（Out-point）非常困难。
*   **产品化思路**：
    *   **语义化剪辑 (Semantic Cutting)**：用户不需要手动拖拽时间轴，而是通过描述“在这里加快节奏”或“给主角一个特写反应镜头”。
    *   **智能节奏对齐 (Rhythmic Sync)**：AI 自动分析背景音乐（BGM）的波形和情绪转折点，自动切分镜头边际。
    *   **叙事代理 (Narrative Agent)**：AI 作为一个“剪辑助理”，根据剧本的冲突点（Climax）自动建议镜头的排列顺序和转场方式。

---

## 🛠️ 待实现功能原型 (Future Roadmap)

### Phase A: 视觉锚定 (The KV Anchor)
- [ ] **Global KV Slot**: 在 Story 级别增加一个全局 KV 槽位。
- [ ] **Style Extractor**: 开发一个轻量级组件，从 KV 中提取 Prompt 关键词（如 "Golden Hour", "Kodak Portra 400", "High Contrast"）并自动补全到所有 Shot 的 Elements 中。

### Phase B: 智能导演剪辑 (AI Editor Proxy)
- [ ] **Prompt-based Sequencing**: 支持通过对话调整镜头顺序，例如：“把 Kenji 发现线索的那个镜头移到开头作为悬念”。
- [ ] **Transition Intelligence**: 在 Shot 之间增加 AI 转场建议（如 Match Cut, Fade to Black），并根据前后镜头的视觉连续性自动生成过渡帧。

### Phase C: 商业化导出预设 (Commercial Presets)
- [ ] **Format Adaptation**: 一键将 KV 适配为 9:16 (TikTok/Reels), 16:9 (TVC), 4:5 (Instagram) 且保持核心构图不丢失。

---

## 📐 设计草图 (Design Sketches)

*   **Inspector Panel 增强**：在右侧面板顶部增加一个常驻的 "Key Visual Reference" 缩略图。
*   **Timeline View 进化**：目前的阶段（Stage）是离散的卡片，未来可能需要一个“磁吸式流感时间轴”，通过 AI 预测镜头间的逻辑连接。

---
*Last Updated: 2025-05-22*