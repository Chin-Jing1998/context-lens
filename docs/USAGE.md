# Context Lens 使用说明

Context Lens 默认在 Claude Code 的状态栏入口静默采集，并通过独立桌面悬浮球展示。Codex CLI 使用官方程序和原生指标，完整统计通过悬浮球查看。主会话与其子代理分别累计。Windows 安装版、便携版、主题和更新设置见[桌面应用](DESKTOP.md)。

## 独立桌面应用

在仓库执行：

```sh
npm ci
npm run build
node scripts/context-lens.mjs desktop --install
```

首次构建需要带 macOS 26 SDK 的 Xcode Command Line Tools 和 Node.js 24，并从 Node.js 官方仓库获取对应版本许可证。应用声明的运行下限仍为 macOS 13.5：macOS 26+ 使用 `NSGlassEffectView`，旧系统使用标准磨砂材质。生成的应用内含 Node.js、生产依赖、网页和统计程序，安装后无需仓库、系统 Node.js 或终端服务。构建产物针对当前 Mac 的架构，未进行 Apple 公证；所选 Node.js 自身的系统要求同样适用。

应用安装在 `~/Applications/Context Lens.app`。安装器创建 `~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist`，登录后在后台监听应用活动。打开或激活 Claude、Codex 桌面端及常见终端时，悬浮球自动显示。后台监听器退出后，需重新打开 Context Lens；下一次登录也会启动。更新时保留旧应用与 LaunchAgent 的备份。

- 圆球直径 56 pt，显示占比与细进度环；客户端名称放在悬停提示中。拖动后保存位置。
- 悬停或点击圆球展开直径 192 pt 的环形岛，上下文、用量、费用按 44%／33%／23% 分配区域，沿用圆球的玻璃材质。悬停区域打开对应详情卡片；点击可保持展开。
- 详情卡片直接展示对应指标，不重复显示会话栏及连接状态。上下文、用量和费用卡片宽度分别为 360、396、440 pt，高度随内容调整；长内容在屏幕内滚动。
- 移出环形岛和详情卡片后延迟收起；再次点击圆球或按 Escape 可关闭。展开与收起使用缩放和淡入淡出，系统“减少动态效果”启用时只保留透明度变化。
- 占比达到 70% 和 90% 时分别变为橙色、红色；未知显示“—”。
- 菜单栏图标和右键菜单提供打开、收起、隐藏／恢复、设置与退出。
- 切到无关应用时隐藏圆球与面板；下次进入支持应用时只恢复圆球。手动隐藏保持到下一次真正进入支持应用，后台刷新不会撤销隐藏。
- 从菜单主动打开或恢复立即生效，下一次外部应用切换后继续按前台应用跟随。操作本应用窗口和菜单不会误判为离开支持应用。
- 收起与隐藏均保留展开状态和未保存的价格草稿；退出会停止应用自行启动的服务，手动启动的服务保留。
- 独立网页顶部显示当前活跃对话的标题和完整会话编号，不提供会话选择入口。桌面设置通过菜单栏或悬浮球右键菜单打开。

自动定位优先使用前台窗口的会话编号或唯一对话标题，再结合前台进程归属、Claude 会话登记和 Codex 进程持有的会话文件。前台窗口提供编号或标题时，同一应用内切换对话无需发送新消息；后台输出不会改变归属。终端提供当前目录或 TTY 时，候选会话进一步限定到该终端。重复标题、缺少标识及尚未产生本地记录的对话保持未知。

读取前台窗口标识需要 macOS 辅助功能权限。通过“设置 → 显示 → 开启前台会话跟随”打开系统设置，允许 Context Lens。应用仅读取导航标识与标题，不读取聊天正文。未授权时继续使用进程归属和明确交互记录定位。普通 Chat、Cowork、云端会话没有本地用量日志时不在支持范围内。

停用登录监听：

```sh
launchctl bootout "gui/$(id -u)/io.github.Chin-Jing1998.context-lens"
mv ~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist ~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist.disabled
```

临时打开而不安装登录监听：`node scripts/context-lens.mjs desktop`。其他操作系统可使用 `serve` 网页和 `watch` 终端模式。

## Claude CLI 静默采集

插件安装方式见 README。默认 `display.showTerminal: false`：终端不输出 Context Lens 状态信息，实时窗口、缓存和计数仍供悬浮球使用。旧 `showLens: true` 不会绕过总开关。

独立应用也可提供采集程序。在仓库执行以下命令，安装器备份原配置并将状态栏指向应用内运行环境：

```sh
APP="$HOME/Applications/Context Lens.app/Contents/Resources/runtime"
"$APP/node" scripts/setup.mjs install --shell posix --entry "$APP/dist/index.js"
```

后续 Claude 状态栏刷新时生效。显式需要终端兼容显示时，设置 `display.showTerminal: true`；再开启 `display.showLens` 显示完整统计。安装命令的 `--lens` 参数显式开启这两个选项。

Claude 分类优先使用当前压缩区间内的 `/context` 报告；没有报告时，对日志中的提示快照、工具定义、已加载指令、技能列表和 MCP 指令执行本地 tokenizer 计数，标注“≈”。同一区间的新报告覆盖本地计数；加载内容发生变化时，重新计算受影响分类。仅统计实际记录的加载内容，不按安装清单推断。压缩和真实模型切换会使旧分类失效，明确保留的记录可继续使用。错误占位响应不参与计数，不会把已有上下文清零。

界面仅显示正数分类，未知和零值条目隐藏；未能归属的实际占用保留为“未分类占用”。没有分类数据时保留总占用和提示。本地分类计数不改写客户端总占用，合计冲突保留在内部记录中。采集文件仅保存必要计数和标识，不保存提示词或工具定义。

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

桌面与网页共用指标和设置界面。上下文分类与累计明细默认折叠；累计明细以指标为行，主会话／子代理／合计为列。正文使用系统字体，指标数字与费率使用 Times New Roman。主题位于“设置 → 显示”，可跟随系统或指定浅色、深色；减少动态效果、减少透明度与增强对比度随系统辅助功能偏好生效。

## 统计口径

- 默认占比为已用 tokens / autocompact 预算，可切换模型窗口口径。配置在刷新时重读。Claude 环境、可观察的启动覆盖、模型及作用域设置，以及 Codex TOML/profile/运行时元数据均参与解析。
- 原有 `display.autoCompactWindow` 是显式 HUD 手动覆盖，优先于自动发现预算；删除它可跟随客户端设置。关闭自动压缩时使用模型窗口。
- 无法从日志取得实际阈值时使用配置预算，并保留内部精度标识。
- 预算内缓冲：`Free = max(预算 - 已用 - 缓冲, 0)`；预算外预留仅在模型窗口视图显示。未知缓冲不按零计。`body_after_prefix` 缺少前缀基线时不计算占比。
- 分类采用固定颜色。Codex 对日志中明确加载的内容执行 token 计数，已安装清单不计入当前上下文。尚未识别的占用归入 Unclassified；来源、精度、观测时间及合计冲突保留在内部数据中。
- 累计输入包含缓存读取与写入，推理输出包含在输出中。按响应 ID 去重，流式更新取每项最大值。旧格式缺少历史时记录完整性状态。
- 命中率 = 累计缓存读取 tokens / 累计全部输入 tokens；读取次数是缓存读取 tokens 大于零的去重请求数。当前缓存有效性以客户端有效期为据，历史命中不代表当前有效。
- 数字检查点保存在 `~/.config/context-lens/ledger/`，保留已观测的去重统计；未提供或监测前已丢失的历史无法补回。它不是对话备份。

## 会话费用

会话费用按请求记录中的模型和 tokens 自动匹配 OpenAI、Anthropic、DeepSeek、Xiaomi MiMo 和 Z.ai 官方 API 单价，单位为美元／百万 tokens。输入、输出、缓存读取、缓存写入分别计价；长上下文和已记录的处理档位使用对应费率。DeepSeek 按请求时间区分峰时与非峰时，并核对中国公共假日。

应用内置已核验价目表，后台每天从官方价格文档更新。下载或解析失败时沿用上次有效数据。价格缓存位于 `~/.config/context-lens/official-prices-<provider>.json`，与用户价格分开保存。来源与核验时间保留在内部记录中。

“设置 → 模型价格”自动填入当前会话模型的官方单价。修改并保存后，该模型使用自定义单价；未修改的官方价格继续自动更新。自定义价格优先于官方价格，`*` 为其他模型的统一单价。非 USD 币种使用自定义价格，不自动转换汇率。

自定义配置保存至 `~/.config/context-lens/config.json`，支持 `input`、`output`、`cacheRead`、`cacheWrite`、`cacheWrite5m`、`cacheWrite1h`，均以每百万 tokens 计价。`CONTEXT_LENS_HOME` 可指定存储目录。

界面仅显示 API 计价金额。无法匹配价格的模型不套用其他模型费率。订阅费、渠道优惠和工具调用费不纳入 token 计价。界面保留数值、分类和操作控件，移除来源展开项与辅助说明段落。

### 日期、工具及模型费用

费用卡片保留当前会话金额，并提供当天、7d、14d、本月、本季度、本年和自定义日期。7d、14d 包含当天；月、季度、年从当前自然周期首日开始。日期边界按查询端所在时区计算，自定义开始日与结束日均包含在内。

当期费用为所选日期内的请求费用；累计费用为截至结束日的历史请求费用。工具筛选同步作用于总计、模型费用和会话费用。每个模型显示当期与累计金额；会话明细显示对话标题、工具名称及会话编号，每页 20 条，仅供查看。没有活跃会话时仍可查询历史费用。

主会话与子代理按工具和请求标识去重，再汇入同一对话。流式重复记录保留原请求日期；没有有效时间的记录不分配到文件修改日。OpenCode 与 MiMo Code 分叉复制的用量记录早于新会话创建时间，不计为新会话请求。未知价格保持“—”，已计价的部分使用“≥”标识；完整 token 计价使用“≈”。

自动读取 Claude Code、Codex、OpenCode、MiMo Code、DeepSeek Harness 和 ZCode 的本地记录。OpenCode 与 MiMo Code 使用 SQLite 的逐消息用量，ZCode 使用逐请求用量，DeepSeek Harness 使用 v2–v4 JSONL 会话记录。Zstandard 记录需要 Node.js 22.15+；独立应用使用构建时打包的运行环境。

费用账本位于 `~/.config/context-lens/cost-history/`，仅保留工具、会话标识、标题、请求时间、模型和 token 计数。已采集记录在原日志轮转或移除后仍可查询；采集之前已删除的记录无法恢复。其他工具可以写入 `cost-imports/` 的统一计数文档，或通过本机 `POST /api/costs/import` 接入；工具名称不限定于内置名单。

统一文档采用 `version: 1` 和 `sessions` 数组。每个会话包含 `tool`、`toolName`、`id`、可选 `title`／`parentId`、`complete` 及 `requests`。每个请求包含 `id`、`model`、ISO 时间 `at`、`complete` 和全部 token 字段：`input`、`output`、`cacheRead`、`cacheWrite`、`cacheWrite5m`、`cacheWrite1h`、`reasoning`。输入包含缓存读写，输出包含推理；缓存子项不得超过所属总项。重复导入按工具和请求标识去重。接口拒绝无效数据与超过 4 MiB 的请求。

## 验证

```sh
npm test
node scripts/build-desktop.mjs
"desktop/build/Context Lens.app/Contents/MacOS/ContextLens" --self-test
codesign --verify --deep --strict "desktop/build/Context Lens.app"
```

CI 包含 Node.js 22/24、Windows Git 回归、macOS 应用构建与 Windows exe 构建和启动核验。[桌面安装与主题设置](DESKTOP.md)。[上游同步说明](../UPSTREAM.md)。
