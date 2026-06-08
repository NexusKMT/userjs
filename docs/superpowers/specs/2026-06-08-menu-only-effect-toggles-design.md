# 设计文档：精简版「禁用网页无用特效」用户脚本

- 日期：2026-06-08
- 目标文件：`disable-page-jank-effects.user.js`
- 版本：3.0.0（破坏性重构）

## 背景与目标

现有脚本（v2.4.0，内部代号 *Universal Force Lite*）把一个极简需求做成了大工程：带右下角悬浮控制面板、模式预设、按网站白名单、按站点覆盖、帧节流数值、统计信息。接手后确认真实需求：

- **目标**：干掉网页上一大堆**无用视觉特效**（动画、模糊、装饰性 canvas、后台动画循环等）。
- **唯一交互入口**：Tampermonkey 下拉菜单。每个功能一个开关，点一下开 / 关。
- **不要**任何页面内悬浮窗 / 控制面板。
- 整体**极其简单**：全局设置，对所有网站生效。

## 范围

### 保留的功能（6 个开关）

| 键名 | 菜单名 | 作用 | 默认 |
|---|---|---|---|
| `cssMotion` | CSS 动画/过渡 | 注入 CSS 关掉动画、过渡、平滑滚动 | 开 |
| `visualEffects` | 模糊/滤镜 | 关掉 `blur` / `backdrop-filter` / `filter` | 开 |
| `webAnimations` | Web 动画 | 结束有限的 `Element.animate`、取消无限 WAAPI 循环 | 开 |
| `mediaPreferences` | 减少动效偏好 | 让 JS 的 `matchMedia` 报告 `prefers-reduced-motion` / `-transparency` / `-data` | 开 |
| `hideDecorativeCanvas` | 隐藏装饰 canvas | 隐藏疑似背景/粒子/全屏装饰 canvas（保留图表类 canvas） | 关 |
| `blockDecorativeRAF` | 屏蔽后台动画循环 | 拦截调用栈像装饰性背景动画的 `requestAnimationFrame` 循环 | 关 |

- `cssMotion` / `visualEffects` 启用时，自动把同款 CSS 覆盖注入到新建的 Shadow DOM（吸收原 `shadowDomStyles`，不再单独成项）。
- **默认值理由**：现在对所有网站默认生效，所以把"几乎不会弄坏页面"的 4 项默认开，把"可能误伤正常内容"的 2 项默认关，需要时再手动开。

### 删除的功能

- `contentVisibility`（内容可见性）— 属性能微调，非"无用特效"，且偶尔造成滚动条跳动。
- `shadowDomStyles` — 并入 `cssMotion` / `visualEffects` 自动处理。
- `throttleChartRAF` / `throttleGenericRAF`（图表 / 通用 RAF 节流）— 依赖被删除的帧节流数值，且"节流"是减速而非去除特效。

### 删除的机制（外壳）

- **整个右下角悬浮面板**：`PANEL_CSS`（约 500 行）+ `renderPanel` / `createPanelBody` / `installPanel` / `createSwitch` / `createModeControls` / `createFeatureRows` / `createNumberControl` / `createStatsGrid` / `getPanelData` / `statusForPanel` 等全部渲染代码。
- **模式预设**（Off / Conservative / Balanced / Aggressive）及 `MODES`。
- **按网站白名单**（allowlist）及相关 add / remove / match 逻辑。
- **按站点覆盖**（host settings）及 `getHostSettings` / `writeHostSettings` / 各 override 函数。
- **帧节流数值**（`chartFrameMs` / `genericFrameMs`）及 `DEFAULT_VALUES`、数值输入。
- **统计信息面板**与 `stats()` 中供面板展示的部分（可保留极少量 `console` 调试，可选）。

## 架构

单文件 IIFE，`@run-at document-start`。三层结构：

### 1. 配置层
- `FEATURES`：6 项的元数据（`key`、菜单名、说明、默认值 `default`）。
- 存储：`GM_getValue` / `GM_setValue`，每项一个布尔，键名如 `__ufl:cssMotion`；读不到时回退到 `default`。
- `getSettings()`：返回 6 个布尔的对象。
- `toggleFeature(key)`：翻转并保存。

### 2. 特效处理引擎（保留并精简自现有代码）
- `applyCss()`：按 `cssMotion` / `visualEffects` 拼 CSS，注入 `<style>`，给 `<html>` 加 root class。
- `patchAttachShadow()`：`cssMotion` / `visualEffects` 任一开启时，给新 shadow root 注入同款 CSS。
- `patchMatchMedia()`：`mediaPreferences` 开启时改写 `matchMedia`。
- `patchWebAnimations()` + `reduceExistingWebAnimations()`：`webAnimations` 开启时处理 `Element.animate` / WAAPI / `startViewTransition`。
- `markDecorativeCanvases()` + `looksLikeDecorativeCanvas()`：`hideDecorativeCanvas` 开启时隐藏装饰 canvas（保留 `looksLikeChartCanvas` 白名单）。
- `patchRAF()`：`blockDecorativeRAF` 开启时拦截装饰性 `requestAnimationFrame`（**不再有节流分支**）。
- `MutationObserver`：DOM 变化后重新应用 CSS / canvas / WAAPI。
- 只对"已启用"的功能生效；全关时脚本基本不动页面。
- **frame 范围**：特效引擎在所有命中的 frame（含 iframe）内运行；菜单仅在顶层 frame 注册（见第 3 层），避免重复菜单项。

### 3. 菜单层
- `isTopFrame()` 时，给 6 项各注册一个 `GM_registerMenuCommand`。
- 标签：开 → `✅ CSS 动画/过渡 — 点击关闭`；关 → `⬜ CSS 动画/过渡 — 点击开启`。
- 点击 → `toggleFeature(key)` 保存 → `location.reload()`。
- 刷新后脚本在 `document-start` 重新读取设置并重建菜单，标签自动反映新状态。

## 生效方式

切换任一功能后**自动刷新当前页**。理由：`blockDecorativeRAF` / `matchMedia` / `webAnimations` 等必须在页面脚本运行前于 `document-start` 完成 patch，运行中再切换无法干净生效。刷新让每次切换都从干净状态应用，逻辑最简单可靠。代价：切换会丢失页面未保存的临时状态（可接受）。

## 元数据 / `@grant`

- `@grant`：`GM_registerMenuCommand`、`GM_getValue`、`GM_setValue`、`unsafeWindow`。
- 不再需要：`GM_unregisterMenuCommand`（刷新即重建）、`GM_deleteValue`。
- `@match`：`http://*/*` 与 `https://*/*`（对所有网站生效；保守默认保证安全）。
- `@run-at`：`document-start`。
- `@version`：`3.0.0`。

## 错误处理

- 所有存储读写、patch 包在 `try`/`catch`，失败仅 `console.warn`，不影响页面。
- `unsafeWindow` 不可用时回退到 `window`。
- patch 前保留 native 引用，避免重复包裹。

## 测试 / 验收标准

- 全新安装后默认：动画/过渡、模糊/滤镜、Web 动画、减少动效偏好 = 开；装饰 canvas、后台动画循环 = 关。
- 菜单出现 6 个开关，标签随状态显示 ✅ / ⬜。
- 点击任一项 → 页面刷新 → 该项状态翻转、标签更新、对应特效行为改变。
- 关闭全部 → 脚本不改动页面（仅注入空 style / 极小开销）。
- 在带 CSS 动画、模糊玻璃、装饰背景 canvas、背景 RAF 动画的测试页上，验证各开关确实生效。
- 页面上**不出现任何悬浮面板**。

## 不做（YAGNI）

- 不做页面内任何 UI。
- 不做按网站记忆 / 白名单。
- 不做模式预设、节流数值、统计面板。
- 不做导入导出 / 同步。
