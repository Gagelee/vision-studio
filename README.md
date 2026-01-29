# Shopee Vision Studio: 次世代 AIGC 导演工作站

> **从“剪辑师”进化为“导演”。**  
> Shopee Vision Studio 是一款基于层级化架构（Hierarchical）与智能代理（Agent-driven）驱动的视频创作平台。我们彻底抛弃了传统的线性时间轴（Linear Timeline），转向以“故事-场次-镜头”为核心的创作逻辑。

---

## 🎞️ 产品理念 (Product Philosophy)

在 AIGC 时代，视频创作的瓶颈不再是“制作（Production）”，而是“表达（Expression）”。

传统的视频软件是为“修剪”设计的，而 Shopee Vision Studio 是为“生成”设计的。我们认为：
1. **意图优于操作**：创作者应当关注“我要什么画面”，而非“我如何移动关键帧”。
2. **结构化叙事**：视频是一组有序的叙事单元（Sequences），而非一段连续的像素流。
3. **资产即上下文**：环境（Sets）与角色（Cast）应该是可复用的“语义对象”，而非孤立的提示词片段。

---

## 🎨 设计哲学 (Design Philosophy)

Shopee Vision Studio 的 UI/UX 遵循 **“专业级沉浸（Pro-Immersion）”** 原则：

*   **空间化布局**：左侧为“世界树（World Tree）”，中间为“取景器（Stage）”，右侧为“执导板（Inspector）”。
*   **语义化色彩**：
    *   🔵 **天蓝色 (Sky)**：代表摄影机（Camera），负责构图与运动。
    *   🟠 **琥珀色 (Amber)**：代表灯光（Lighting），负责氛围与质感。
    *   🔴 **玫瑰色 (Rose)**：代表声效（Audio），负责空间感。
    *   🟣 **靛蓝色 (Indigo)**：代表表演（Casting），负责角色一致性。
*   **上下文感知（Context-Aware）**：Inspector 具有强大的“继承（Inheritance）”逻辑。当你在 Shot 级别未定义灯光时，它会自动继承 Environment 的全局氛围。

---

## 🚀 核心功能 (Core Features)

### 1. 导演控制台 (Director Console)
*   **自然语言执导**：通过底部控制台输入“将这组镜头的色调调冷，并增加景深”，AI 代理将自动拆解指令并修改所有相关参数。
*   **多模态切换**：支持在沉浸模式下通过悬浮窗进行即时反馈。

### 2. 资产实验室 (Asset Labs)
*   **数字片场 (Environments)**：创建并锁定“置景”。一旦设定，该场次下的所有镜头将自动共享一致的视觉特征（LoRA 级一致性）。
*   **选角系统 (Casting)**：通过视觉提示词锁定角色面部特征，确保在不同分镜中“不掉脸”。

### 3. 执导面板 (Cinematic Inspector)
*   **参数化生成**：将复杂的 Prompt 拆解为摄影机、灯光、音效、剧本四个专业维度。
*   **状态锁定**：支持 AI 自动生成（Auto）与人工干预（Manual）的混合工作流。

### 4. 沉浸式取景器 (Immersive Stage)
*   **非线性预览**：在故事板视图中直接观察叙事节奏，一键进入全屏沉浸模式进行细节审阅。

---

## 💡 最佳实践 (Best Practices)

1. **先置景，后分镜**：
   先在 `Environments` 中定义好环境的全局风格（如：赛博朋克、霓虹灯光、下雨），这样你在创建新镜头时，AI 会自动为你补全背景底色。

2. **锁定核心角色**：
   在 `Casting` 模块中为主角建立 Profile。在具体镜头中，只需提及角色名字，AI 即可根据 Profile 中的详细描述保持形象稳定。

3. **利用“语义微调”**：
   如果你觉得某个镜头的氛围不对，不需要重写整个 Prompt。在 `Director Console` 输入“增加侧光”或“改为特写”，系统会精准定位到 `Lighting` 或 `Camera` 模块进行局部修改。

4. **版本分枝 (Version Branching)**：
   利用镜头的 `Version History` 功能生成多种风格尝试（如：白天 vs 黑夜），对比后再确定最终的 `Active Version`。

---

## 🛠️ 技术架构

*   **Frontend**: React 19 + TypeScript + TailwindCSS
*   **Icons**: Lucide React
*   **Intelligence**: 集成 Google Gemini 系列模型 (Flash/Pro) 进行多模态解析与指令拆解。
*   **State Management**: 基于 Context 与层级化 State 的复杂资产管理系统。

---

© 2025 Shopee Vision Studio. 重新定义 AI 影像创作。