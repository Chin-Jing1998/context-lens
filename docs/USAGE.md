# Context Lens 使用说明

Context Lens 保留 Claude Code 原生状态栏，并提供独立 macOS 悬浮球。Codex CLI 使用官方程序和原生指标，完整统计通过悬浮球查看。主会话与其子代理分别累计。

## 独立桌面应用

在仓库执行：

```sh
npm ci
npm run build
node scripts/context-lens.mjs desktop --install
```

首次构建需要 macOS 13.5+、Xcode Command Line Tools 和 Node.js 18+，并从 Node.js 官方仓库获取对应版本许可证。生成的应用内含 Node.js、生产依赖、网页和统计程序，安装后无需仓库、系统 Node.js 或终端服务。构建产物针对当前 Mac 的架构，未进行 Apple 公证；所选 Node.js 自身的系统要求同样适用。

应用安装在 `~/Applications/Context Lens.app`。安装器创建 `~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist`，登录后在后台监听应用活动。打开或激活 Claude、Codex 桌面端及常见终端时，悬浮球自动显示。后台监听器退出后，需重新打开 Context Lens；下一次登录也会启动。更新时保留旧应用与 LaunchAgent 的备份。

- 拖动移动，位置在下次启动恢复。
- 点击展开；再次点击、Escape 或关闭面板可收起。
- 占比达到 70% 和 90% 时分别变为橙色、红色；未知显示“—”。
- 菜单栏图标和右键菜单提供展开、收起与退出。
- 收起后继续刷新；退出会停止应用自行启动的服务，手动启动的服务保留。
- 勾选“自动定位会话”启用跟随；手动选择会话会固定该会话。

自动定位结合前台应用进程归属、Claude 会话登记和 Codex 进程实际持有的会话文件。只有一个明确候选时自动绑定；多个会话或旧版本缺少登记时提示选择，不根据最新历史日志猜测。无需屏幕录制或辅助功能权限。普通 Chat、Cowork、云端会话没有本地 CLI 用量日志时不在支持范围内。

停用登录监听：

```sh
launchctl bootout "gui/$(id -u)/io.github.Chin-Jing1998.context-lens"
mv ~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist ~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist.disabled
```

临时打开而不安装登录监听：`node scripts/context-lens.mjs desktop`。其他操作系统可使用 `serve` 网页和 `watch` 终端模式。

## Claude CLI 原生状态栏

插件安装方式见 README。完整显示为可选配置，在 `~/.claude/context-lens.json` 中设置：

```json
{"display":{"showLens":true}}
```

独立应用也可提供状态栏程序。在仓库执行以下命令，它会备份原设置、替换 `statusLine` 并启用完整显示：

```sh
APP="$HOME/Applications/Context Lens.app/Contents/Resources/runtime"
"$APP/node" scripts/setup.mjs install --shell posix --entry "$APP/dist/index.js" --lens
```

Claude 在后续状态栏刷新时应用。未启用 `showLens` 时保持默认两行布局。stdin 提供窗口和缓存有效期；完整模式仅保存必要计数。运行 `/context` 后优先读取结构化分类，兼容旧版本命令文本。未知分类显示“—”。

## Codex CLI 与本地网页

```sh
node scripts/context-lens.mjs codex -- --model YOUR_MODEL
node scripts/context-lens.mjs list --client codex
node scripts/context-lens.mjs watch --session codex:SESSION_ID
node scripts/context-lens.mjs watch --session codex:SESSION_ID --once --json
node scripts/context-lens.mjs serve --port 47831
```

`codex` 按原样传递参数给官方 CLI，不创建 tmux 分区、不修改 Codex 源码或用户配置。继续直接运行 `codex` 也可使用悬浮球。CLI 内置指标由其原生设置控制。

网页默认为 `http://127.0.0.1:47831/`，也可在桌面端内置浏览器打开。接口仅监听本机，拒绝外站 Origin、无效 Host、路径形式的会话标识和无效价格。`watch` 无会话参数时显示选择器，q 或 Ctrl+C 退出。

## 统计口径

- 默认占比为已用 tokens / autocompact 预算，可切换模型窗口口径。配置在刷新时重读，面板显示来源。Claude 环境、可观察的启动覆盖、模型及作用域设置，以及 Codex TOML/profile/运行时元数据均参与解析。
- 原有 `display.autoCompactWindow` 是显式 HUD 手动覆盖，优先于自动发现预算；删除它可跟随客户端设置。关闭自动压缩时使用模型窗口。
- 缺少实际阈值时标注估算。读取设置文件不代表运行中的客户端已重载；不可观察的启动覆盖不会冒充已确认设置。
- 预算内缓冲：`Free = max(预算 - 已用 - 缓冲, 0)`；预算外预留仅在模型窗口视图显示。未知缓冲不按零计。`body_after_prefix` 缺少前缀基线时不计算占比。
- 分类包含固定颜色、来源、精度和观测时间。Codex 只估算日志中明确已加载的内容，不把已安装清单当成当前上下文；未知部分归入 Unclassified，合计冲突会提示。
- 累计输入包含缓存读取与写入，推理输出包含在输出中。按响应 ID 去重，流式更新取每项最大值。旧格式缺少历史时标注不完整。
- 命中率 = 累计缓存读取 tokens / 累计全部输入 tokens；读取次数是缓存读取 tokens 大于零的去重请求数。当前缓存有效性以客户端有效期为据，历史命中不代表当前有效。
- 数字检查点保存在 `~/.config/context-lens/ledger/`，保留已观测的去重统计；未提供或监测前已丢失的历史无法补回。它不是对话备份。

## 自定义价格

面板下方可设置每百万 tokens 单价。留空为未配置，0 为免费；`*` 可配置未单独定价模型的默认费率。支持 `input`、`output`、`cacheRead`、`cacheWrite`、`cacheWrite5m`、`cacheWrite1h`，按请求实际模型重算。

配置保存至 `~/.config/context-lens/config.json`，可通过 `CONTEXT_LENS_HOME` 改变目录。初始配置不假定任何单价：

```json
{"currency":"USD","prices":{}}
```

缺少价格或历史不完整时显示未配置或部分估算。客户端报告费用与自定义费用分别保留。

## 验证

```sh
npm test
node scripts/build-desktop.mjs
"desktop/build/Context Lens.app/Contents/MacOS/ContextLens" --self-test
codesign --verify --deep --strict "desktop/build/Context Lens.app"
```

CI 包含 Node.js 18/20、Windows Git 回归和 macOS 应用构建。源码分支不提交 `dist/`，主分支工作流维护构建产物。[上游同步说明](../UPSTREAM.md)。
