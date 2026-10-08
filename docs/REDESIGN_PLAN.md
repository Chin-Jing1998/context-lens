# Context Lens 界面重构计划

## 背景

Context Lens 是一个 Claude Code 插件，提供三种界面形态：

1. **CLI 状态栏**：每次对话后输出的静态文本（通过 `console.log`），无交互能力
2. **Web UI**：浏览器访问的仪表盘，使用 Liquid Glass 设计语言
3. **macOS 悬浮球**：56×56pt 圆球与 420×620pt 面板，支持拖拽定位

当前问题：

- CLI 输出占用过多垂直空间，context 信息默认全显示且无法收起
- Web UI 与悬浮球虽已实现 Liquid Glass，但动画与交互体验尚有提升空间
- 缺少视觉层级、微交互反馈和流畅过渡

目标：

1. **CLI**：改为默认精简输出，上下文详情按需显示，减少垂直占用
2. **Web UI & 悬浮球**：增强动画流畅度、视觉层级和交互反馈
3. 保持向后兼容，新行为通过配置选项控制

## 约束

- CLI 为静态 `console.log` 输出，不支持交互式折叠，只能通过配置控制显示内容
- 必须遵守 `prefers-reduced-motion` 媒体查询，提供无动画降级
- 保持现有测试通过（395 项自动化测试）
- macOS 应用需保留 macOS 13.5+ 兼容性，NSGlassEffectView 仅用于 macOS 26+

## 方案设计

### 一、CLI 精简输出（核心改动）

#### 问题根源

`src/render/expanded.ts:134-141` 硬编码了三行始终显示：

```typescript
const gitFiles = gitFilesLine(f);
if (gitFiles) lines.push(gitFiles);
if (f.config?.display?.showSessionTokens) {
  const tokens = sessionTokensSummary(f, t('label.tokens'));
  if (tokens) lines.push(tokens);
}
const compactions = compactionsPart(f);
if (compactions) lines.push(compactions);
```

这些行绕过了 `elementOrder` 系统，导致无法通过配置控制。

#### 新增配置项

在 `src/config.ts` 的 `Display` 接口添加：

```typescript
interface Display {
  // 现有字段...

  /** 上下文详情显示时机：'always' | 'warning' | 'critical' | 'never' */
  contextDetailMode?: 'always' | 'warning' | 'critical' | 'never';

  /** 用量详情显示时机：'always' | 'threshold' | 'never' */
  usageDetailMode?: 'always' | 'threshold' | 'never';

  /** compact 模式下上下文格式：'full' (45% 90k/200k) | 'minimal' (45%) */
  compactContextFormat?: 'full' | 'minimal';

  /** compact 模式是否显示 git 文件统计，默认 false */
  showGitFilesInCompact?: boolean;

  /** 默认隐藏 session tokens 总结行，默认 true */
  defaultHideSessionTokens?: boolean;

  /** 仅当 compactions > 0 时显示，默认 true */
  showCompactionsOnlyWhenPresent?: boolean;
}
```

默认值（新安装用户）：

```typescript
contextDetailMode: 'critical',        // 85%+ 才显示 token breakdown
usageDetailMode: 'threshold',         // 达到阈值才显示重置时间
compactContextFormat: 'minimal',      // 仅显示百分比
showGitFilesInCompact: false,         // compact 模式不显示 git 文件
defaultHideSessionTokens: true,       // 默认隐藏 session tokens 行
showCompactionsOnlyWhenPresent: true, // 仅有压缩时显示
```

#### 修改文件

**1. `src/config.ts` (542 → ~580 行)**

添加上述新字段和验证规则：

```typescript
const CONTEXT_DETAIL_MODES = ['always', 'warning', 'critical', 'never'] as const;
const USAGE_DETAIL_MODES = ['always', 'threshold', 'never'] as const;
const COMPACT_CONTEXT_FORMATS = ['full', 'minimal'] as const;

// 在 DEFAULT_CONFIG 中添加默认值
display: {
  // ...现有字段
  contextDetailMode: 'critical',
  usageDetailMode: 'threshold',
  compactContextFormat: 'minimal',
  showGitFilesInCompact: false,
  defaultHideSessionTokens: true,
  showCompactionsOnlyWhenPresent: true,
}
```

**2. `src/render/context.ts` (43 → ~60 行)**

重构 `tokenBreakdown()` 函数以支持 `contextDetailMode`：

```typescript
export function tokenBreakdown(f: Frame): string {
  const display = f.config?.display;
  const usage = f.stdin.context_window?.current_usage;
  if (display?.showTokenBreakdown === false || !usage) return '';

  const mode = display?.contextDetailMode ?? 'critical';
  const context = contextUsage(f);

  // 根据模式判断是否显示
  if (mode === 'never') return '';
  if (mode === 'always') {
    // 始终显示
  } else if (mode === 'warning') {
    const threshold = display?.contextWarningThreshold ?? 70;
    if (context.percent < threshold) return '';
  } else { // 'critical'
    const threshold = display?.contextCriticalThreshold ?? 85;
    if (context.percent < threshold) return '';
  }

  const input = formatTokens(usage.input_tokens ?? 0);
  const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
  return label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, f.config?.colors);
}
```

修改 `contextBarAndValue()` 以支持 `compactContextFormat`：

```typescript
export function contextBarAndValue(f: Frame): { bar: string | null; value: string } {
  const display = f.config?.display;
  const colors = f.config?.colors;
  const context = contextUsage(f);

  const format = display?.compactContextFormat ?? 'full';
  const mode = display?.contextValue ?? 'percent';

  // minimal 格式强制使用 percent 模式
  const valueMode = format === 'minimal' ? 'percent' : mode;

  const value = `${getContextColor(context.percent, colors, thresholds(f))}${formatContextValue(context, valueMode)}${RESET}`;
  const bar = display?.showContextBar !== false
    ? coloredBar(context.percent, f.barWidth, colors, thresholds(f))
    : null;
  return { bar, value };
}
```

**3. `src/render/compact.ts` (63 → ~95 行)**

重构 `sessionLine()` 和 `compactLines()`，将硬编码的三行改为条件性添加：

```typescript
function sessionLine(f: Frame): string {
  const parts: Part[] = [];
  const add = (text: string | null, key: Part['key'] = null): void => {
    if (text) parts.push({ key, text });
  };

  add(customLinePart(f, 'first'));
  add(modelCluster(f), 'model');
  for (const part of projectParts(f, 'compact')) add(part, 'project');
  add(sessionNamePart(f), 'sessionName');
  add(versionPart(f), 'version');
  configCountParts(f).forEach((part) => add(part));
  (usageParts(f, 'compact') ?? []).forEach((part) => add(part));

  // 条件性添加 session tokens（原先硬编码在 expanded.ts）
  const display = f.config?.display;
  const hideTokens = display?.defaultHideSessionTokens ?? false;
  if (display?.showSessionTokens && !hideTokens) {
    add(sessionTokensSummary(f, `${t('format.tok')}:`));
  }

  // 条件性添加 compactions
  const showOnlyWhenPresent = display?.showCompactionsOnlyWhenPresent ?? true;
  const compactionText = compactionsPart(f);
  if (compactionText && (!showOnlyWhenPresent || f.transcript?.compactions > 0)) {
    add(compactionText);
  }

  add(advisorPart(f), 'advisor');
  add(durationPart(f), 'duration');
  add(sessionTimeLine(f));
  add(promptCacheLine(f));
  add(cacheHitRateLine(f));
  add(costPart(f), 'cost');
  add(speedPart(f), 'speed');
  add(extraPart(f), 'extra');
  add(authPart(f), 'auth');
  add(customLinePart(f, 'last'));

  const line = orderParts(parts, f.config?.projectLineOrder ?? DEFAULT_PROJECT_LINE_ORDER).join(' | ');
  return line + tokenBreakdown(f);
}

export function compactLines(f: Frame): string[] {
  const header = sessionLine(f);
  const activity = ACTIVITY.map((element) => activityLine(f, element)).filter((line): line is string => !!line);
  const lines = [header];

  // 条件性添加 git 文件行
  const display = f.config?.display;
  const showGitFiles = display?.showGitFilesInCompact ?? false;
  if (showGitFiles) {
    const gitFiles = gitFilesLine(f);
    if (gitFiles) lines.push(gitFiles);
  }

  if (f.config?.showSeparators && activity.length > 0) {
    const widest = Math.max(visibleWidth(header), 20);
    lines.push(separatorLine(f.width ? Math.min(widest, f.width) : widest));
  }
  return [...lines, ...activity];
}
```

**4. `src/render/expanded.ts` (150 → ~145 行)**

移除 134-141 行的硬编码追加逻辑，这些行现在在 compact 模式由配置控制，在 expanded 模式保持原有行为（通过 `elementOrder` 控制）：

```typescript
export function expandedLines(f: Frame): string[] {
  // ... 前面的代码保持不变 ...

  const lines = rows.map(({ line }) => line);

  // Git 文件行保持在 expanded 模式显示（与之前行为一致）
  const gitFiles = gitFilesLine(f);
  if (gitFiles) lines.push(gitFiles);

  // Session tokens 和 compactions 现在通过配置控制
  const display = f.config?.display;
  const hideTokens = display?.defaultHideSessionTokens ?? false;
  if (display?.showSessionTokens && !hideTokens) {
    const tokens = sessionTokensSummary(f, t('label.tokens'));
    if (tokens) lines.push(tokens);
  }

  const showOnlyWhenPresent = display?.showCompactionsOnlyWhenPresent ?? true;
  const compactions = compactionsPart(f);
  if (compactions && (!showOnlyWhenPresent || f.transcript?.compactions > 0)) {
    lines.push(compactions);
  }

  // 分隔符逻辑保持不变
  const firstActivity = rows.findIndex(({ activity }) => activity);
  if (f.config?.showSeparators && firstActivity > 0) {
    const widest = Math.max(...rows.slice(0, firstActivity).map(({ line }) => visibleWidth(line)), 20);
    lines.splice(firstActivity, 0, separatorLine(f.width ? Math.min(widest, f.width) : widest));
  }
  return lines;
}
```

### 二、Web UI 动画增强

#### CSS 时间令牌系统

**`web/style.css` (154 → ~240 行)**

添加动画时间令牌和新的 keyframes：

```css
:root {
  /* ... 现有颜色变量 ... */

  /* 动画时间令牌 */
  --timing-instant: 80ms;
  --timing-quick: 120ms;
  --timing-standard: 180ms;
  --timing-deliberate: 240ms;
  --timing-ring: 400ms;
  --timing-count: 600ms;

  /* 缓动函数 */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-out: cubic-bezier(0.33, 1, 0.68, 1);
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

  /* 状态着色 */
  --glass-tint: var(--glass);
}

/* 进度环过渡 */
.progress-ring circle {
  transition: stroke-dashoffset var(--timing-ring) var(--ease-in-out);
}

/* 悬停状态 */
.ball-container:hover {
  transform: scale(1.05);
  transition: transform var(--timing-standard) var(--ease-out);
}

.ball-container:active {
  transform: scale(0.92);
  transition: transform var(--timing-quick) var(--ease-spring);
}

/* 面板展开动画 */
@keyframes panelExpand {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.panel-content {
  animation: panelExpand 200ms var(--ease-spring);
}

/* 数据段落级联动画 */
.segment {
  transition: width var(--timing-deliberate) var(--ease-out);
}

.segment:nth-child(1) { transition-delay: 0ms; }
.segment:nth-child(2) { transition-delay: 40ms; }
.segment:nth-child(3) { transition-delay: 80ms; }
.segment:nth-child(4) { transition-delay: 120ms; }

/* 数字更新动画 */
.metric-number {
  font-variant-numeric: tabular-nums;
  transition: opacity var(--timing-quick);
}

.metric-number.updating {
  opacity: 0.6;
}

/* 上下文状态着色 */
.context-panel.warning {
  --glass-tint: color-mix(in oklch, var(--glass), #ff9500 3%);
  background: var(--glass-tint);
}

.context-panel.critical {
  --glass-tint: color-mix(in oklch, var(--glass), #ff3b30 3%);
  background: var(--glass-tint);
}

/* 深色模式玻璃饱和度增强 */
@media (prefers-color-scheme: dark) {
  @supports (backdrop-filter: blur(20px)) {
    .glass {
      backdrop-filter: blur(24px) saturate(145%);
    }
  }
}

/* 减少动态效果 */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }

  .ball-container:hover {
    transform: none;
  }
}

/* 骨架加载状态 */
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--surface) 0%,
    var(--canvas) 50%,
    var(--surface) 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
  border-radius: 4px;
}

/* Toast 通知 */
@keyframes slideInFromTop {
  from {
    transform: translateY(-100%);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.toast {
  animation: slideInFromTop var(--timing-standard) var(--ease-out);
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
}
```

#### JavaScript 交互增强

**`src/lens/browser.ts` (350 → ~450 行)**

添加键盘快捷键、数字动画和加载状态：

```typescript
// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === 'r' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    refreshSnapshot();
    showToast('刷新中...');
  } else if (e.key === 's' && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    document.getElementById('settings-trigger')?.click();
  }
});

// 数字动画（CountUp 效果）
function animateNumber(element: HTMLElement, target: number, duration = 600) {
  const start = parseFloat(element.textContent || '0');
  const startTime = performance.now();

  function update(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    const current = start + (target - start) * eased;

    element.textContent = Math.round(current).toLocaleString();

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// 加载骨架状态
function showLoadingSkeleton() {
  const dashboard = document.getElementById('dashboard');
  if (dashboard) {
    dashboard.classList.add('loading');
    // 关键指标显示骨架
    document.querySelectorAll('.metric-number').forEach(el => {
      el.classList.add('skeleton');
    });
  }
}

function hideLoadingSkeleton() {
  const dashboard = document.getElementById('dashboard');
  if (dashboard) {
    dashboard.classList.remove('loading');
    document.querySelectorAll('.skeleton').forEach(el => {
      el.classList.remove('skeleton');
    });
  }
}

// Toast 通知
function showToast(message: string, duration = 2000) {
  const toast = document.createElement('div');
  toast.className = 'toast glass';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideInFromTop var(--timing-standard) var(--ease-out) reverse';
    setTimeout(() => toast.remove(), 180);
  }, duration);
}

// 渲染函数中添加数字动画
function render(snapshot: HudSnapshot) {
  // ... 现有渲染逻辑 ...

  // 数字更新时触发动画
  const percentEl = document.getElementById('context-percent');
  if (percentEl) {
    const newPercent = snapshot.context?.percent ?? 0;
    const oldPercent = parseFloat(percentEl.textContent || '0');
    if (Math.abs(newPercent - oldPercent) > 1) {
      animateNumber(percentEl, newPercent);
    }
  }

  // 上下文状态着色
  const contextPanel = document.querySelector('.context-panel');
  if (contextPanel && snapshot.context) {
    contextPanel.classList.remove('warning', 'critical');
    if (snapshot.context.percent >= 85) {
      contextPanel.classList.add('critical');
    } else if (snapshot.context.percent >= 70) {
      contextPanel.classList.add('warning');
    }
  }
}
```

### 三、macOS 悬浮球增强

**`desktop/ContextLens.swift` (449 → ~540 行)**

添加点击挤压动画、磁性边缘吸附和脉冲警告：

```swift
// BallView 类添加动画支持
class BallView: NSView {
  // ... 现有代码 ...

  private var isAnimatingPulse = false

  override func mouseDown(with event: NSEvent) {
    // 挤压动画
    NSAnimationContext.runAnimationGroup { context in
      context.duration = 0.12
      context.timingFunction = CAMediaTimingFunction(name: .easeOut)
      self.animator().transform = CATransform3DMakeScale(0.92, 0.92, 1)
    } completionHandler: {
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0.18
        context.timingFunction = CAMediaTimingFunction(controlPoints: 0.34, 1.56, 0.64, 1)
        self.animator().transform = CATransform3DIdentity
      }
    }

    super.mouseDown(with: event)
  }

  func startPulseAnimation() {
    guard !isAnimatingPulse else { return }
    isAnimatingPulse = true

    let animation = CABasicAnimation(keyPath: "transform.scale")
    animation.fromValue = 1.0
    animation.toValue = 1.03
    animation.duration = 1.0
    animation.autoreverses = true
    animation.repeatCount = .infinity
    animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)

    layer?.add(animation, forKey: "pulse")
  }

  func stopPulseAnimation() {
    isAnimatingPulse = false
    layer?.removeAnimation(forKey: "pulse")
  }
}

// 磁性边缘吸附
extension BallWindowController {
  func snapToEdgeIfNeeded(frame: NSRect, in screen: NSScreen) -> NSRect {
    let snapThreshold: CGFloat = 20
    var newFrame = frame
    let visibleFrame = screen.visibleFrame

    // 左边缘
    if abs(newFrame.minX - visibleFrame.minX) < snapThreshold {
      newFrame.origin.x = visibleFrame.minX + 8
    }
    // 右边缘
    if abs(newFrame.maxX - visibleFrame.maxX) < snapThreshold {
      newFrame.origin.x = visibleFrame.maxX - newFrame.width - 8
    }
    // 上边缘
    if abs(newFrame.maxY - visibleFrame.maxY) < snapThreshold {
      newFrame.origin.y = visibleFrame.maxY - newFrame.height - 8
    }
    // 下边缘
    if abs(newFrame.minY - visibleFrame.minY) < snapThreshold {
      newFrame.origin.y = visibleFrame.minY + 8
    }

    return newFrame
  }

  override func mouseUp(with event: NSEvent) {
    super.mouseUp(with: event)

    // 释放时吸附边缘
    if let screen = window?.screen {
      let currentFrame = window!.frame
      let snappedFrame = snapToEdgeIfNeeded(frame: currentFrame, in: screen)

      if snappedFrame != currentFrame {
        NSAnimationContext.runAnimationGroup { context in
          context.duration = 0.3
          context.timingFunction = CAMediaTimingFunction(controlPoints: 0.34, 1.56, 0.64, 1)
          window?.animator().setFrame(snappedFrame, display: true)
        }
      }
    }
  }
}

// 上下文警告时启动脉冲
func updateBallView(percent: Double) {
  if let ballView = ballWindow?.contentView as? BallView {
    if percent >= 85 {
      ballView.startPulseAnimation()
    } else {
      ballView.stopPulseAnimation()
    }
  }
}
```

添加菜单项以锁定位置：

```swift
@objc func togglePositionLock() {
  isPositionLocked.toggle()
  UserDefaults.standard.set(isPositionLocked, forKey: "ballPositionLocked")
}

func buildMenu() -> NSMenu {
  let menu = NSMenu()
  // ... 现有菜单项 ...

  let lockItem = NSMenuItem(
    title: isPositionLocked ? "解锁位置" : "锁定位置",
    action: #selector(togglePositionLock),
    keyEquivalent: ""
  )
  menu.addItem(lockItem)

  return menu
}
```

## 验证策略

### 自动化测试

1. **配置验证测试**（新增）
   - 每个新配置项的默认值、有效范围和无效输入
   - 配置迁移：从无此配置的旧版本升级

2. **渲染回归测试**（现有 + 新增）
   - `npm test` 现有 395 项测试必须全部通过
   - 新增快照测试：`contextDetailMode` 四种模式 × compact/expanded = 8 个场景
   - 新增快照测试：`compactContextFormat` 两种格式的输出对比

3. **动画性能测试**（手动）
   - Chrome DevTools Performance 面板检查 scripting 时间 < 16ms
   - 验证 `prefers-reduced-motion` 下所有动画禁用

### 视觉验证

1. **CLI 输出对比**
   - 在 iTerm2、Terminal.app、Alacritty 分别运行，截图对比
   - 窗口宽度 80/120/160 列三种尺寸

2. **Web UI 截图**
   - Chromium 内置浏览器在 320/420/768/1440 CSS px 下截图
   - 浅色/深色主题各一套
   - 验证无横向溢出

3. **macOS 应用录屏**
   - 使用 fgcap 录制点击挤压、边缘吸附、脉冲动画
   - 验证 60fps 流畅播放

### 可访问性验证

1. Web UI 运行 axe DevTools 检查
2. 验证所有交互元素的键盘可达性
3. 验证颜色对比度（WCAG AA 4.5:1 for 14px text）
4. macOS VoiceOver 朗读测试（手动抽查）

## 关键文件清单

**配置与类型**：
- `src/config.ts` — 新增 6 个配置项、默认值和验证规则

**CLI 渲染**：
- `src/render/context.ts` — `contextDetailMode` 逻辑，`compactContextFormat` 支持
- `src/render/compact.ts` — 重构 `sessionLine()` 和 `compactLines()`，条件性追加行
- `src/render/expanded.ts` — 移除硬编码追加，改用配置控制

**Web UI**：
- `web/style.css` — 时间令牌、动画 keyframes、状态着色、骨架加载
- `src/lens/browser.ts` — 键盘快捷键、数字动画、Toast 通知、加载状态

**macOS 应用**：
- `desktop/ContextLens.swift` — 点击挤压、磁性吸附、脉冲动画、位置锁定菜单

## 实施顺序

1. **阶段一（配置基础）**：修改 `src/config.ts`，添加新字段和默认值
2. **阶段二（CLI 渲染）**：按顺序修改 `context.ts` → `compact.ts` → `expanded.ts`，运行 `npm test` 验证
3. **阶段三（Web UI）**：修改 `style.css` 和 `browser.ts`，浏览器实测动画
4. **阶段四（macOS 应用）**：修改 `ContextLens.swift`，原生编译并 `--self-test`
5. **阶段五（文档与测试）**：更新 README.md 新配置项说明，补充快照测试

## 风险与缓解

**风险 1：现有用户输出突然变短**
- 缓解：仅对新安装生效，现有用户保持当前配置（配置迁移逻辑检测旧配置时保留详细输出）

**风险 2：动画过多造成卡顿**
- 缓解：并发动画限制为 3 个元素，使用 `will-change` 并在动画结束后移除，尊重 `prefers-reduced-motion`

**风险 3：macOS 旧系统兼容性**
- 缓解：所有新动画使用 NSAnimationContext 而非 NSGlassEffectView 专属 API，macOS 13.5+ 均可用

**风险 4：配置项过多导致困惑**
- 缓解：文档提供三套预设（"精简"/"均衡"/"详尽"），用户复制对应 JSON 即可

## 成功标准

1. ✅ `npm test` 全部 395 项测试通过
2. ✅ 新增配置项的单元测试通过
3. ✅ CLI 默认输出减少至 2 行（compact 模式）
4. ✅ Web UI 所有动画在 Chrome DevTools 下脚本时间 < 16ms
5. ✅ macOS 应用原生编译成功，`--self-test` 通过
6. ✅ 浅色/深色主题截图对比无视觉回归
7. ✅ axe DevTools 无严重可访问性问题
8. ✅ 文档更新完成，包含三套配置预设示例
