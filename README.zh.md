<p align="center"><img src="docs/images/context-lens-icon.png" width="96" height="96" alt="Context Lens 应用图标"></p>

# Context Lens

面向 Claude Code、Codex 等 AI 编程工具的本地桌面监测应用。通过悬浮球、七个环形岛和卡片详情，查看会话上下文、用量、费用及工具运行信息。

[English](README.md) · [下载桌面应用](https://github.com/Chin-Jing1998/context-lens/releases/latest) · [安装与使用](docs/DESKTOP.md) · [MIT 许可证](LICENSE)

当前稳定版为 **v0.11.0**。桌面应用源码位于 [main](https://github.com/Chin-Jing1998/context-lens/tree/main) 分支；已发布版本源码位于 [v0.11.0](https://github.com/Chin-Jing1998/context-lens/tree/v0.11.0)。

## 下载与安装

桌面应用自带运行环境，无需另行安装 Node.js。

| 平台 | 下载 | 系统要求 |
| --- | --- | --- |
| macOS | [Apple Silicon ZIP](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/Context-Lens-0.11.0-mac-arm64.zip) | macOS 13.5 及以上，Apple Silicon |
| Windows 安装版 | [安装程序 exe](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/Context-Lens-0.11.0-win-x64-setup.exe) | Windows 10 及以上，x64 |
| Windows 便携版 | [便携程序 exe](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/Context-Lens-0.11.0-win-x64-portable.exe) | Windows 10 及以上，x64 |

[SHA-256 校验文件](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/SHA256SUMS.txt)随版本一同发布。

### macOS 首次启动

解压后将 `Context Lens.app` 放入 Applications。**v0.11.0 的 macOS 包使用临时签名，尚未通过 Apple 公证**，首次打开可能受到系统拦截。核对下载校验值后，可在“系统设置 → 隐私与安全性”中，为 Context Lens 选择“仍要打开”，再确认“打开”。详见 [Apple 首次启动说明](https://support.apple.com/zh-cn/102445)。

启动安全例外与辅助功能授权分别设置。需要识别前台会话时，再在“隐私与安全性”的辅助功能或设备控制权限中，授权实际安装的 Context Lens。

### Windows 启动

安装版创建桌面和开始菜单快捷方式；便携版可直接运行。托盘菜单提供设置、显示悬浮球、锁定位置和退出操作。

## 七个环形岛

| 环形岛 | 展示内容 |
| --- | --- |
| 上下文 | 已用 tokens、窗口占比、分类占用、对话构成与压缩记录 |
| 用量 | 请求、输入、输出、缓存写入与读取，以及可获取的使用率限制 |
| 费用 | 当前会话、累计查询、模型费用及逐请求账单 |
| 命令行 | 执行次数、状态、耗时及调用记录 |
| 技能 | 技能调用次数、名称、状态与记录 |
| MCP | MCP 工具调用次数、状态、耗时与记录 |
| 会话 | 运行时间，以及日志提供的 Hook、文件、任务和子代理信息 |

仅展示日志和接口实际提供的内容。未使用的模型与缺失分类不显示；未知数值使用 `—`，由已有数据计算的近似值保留 `≈`。各客户端提供的字段范围不同。

## 界面与操作

- 点击悬浮球展开环形岛，点击各岛打开对应详情；按 Escape 收起。
- 设置提供九套固定主题：原生玻璃、清透玻璃、石墨仪表、白瓷柔光、光谱轨道、墨芯玻璃、水墨宋韵、青铜书卷、青蓝刻度。
- 数字与英文使用 Times New Roman；中文按主题采用系统中文、宋体、仿宋或楷体。
- 会话详情根据内容调整窗口；费用将当前会话、累计查询和逐请求账单分别展示；长列表支持分页、筛选、排序及自动隐藏滚动条。
- “桌面行为”提供减少动效及前台会话识别入口。
- “关于更新”固定查询本项目 GitHub 的最新正式 Release，并提供下载入口。

## 会话数据接入

应用优先读取本机 Claude Code、Codex 的会话记录；其他已接入客户端按已有本地数据提供统计。桌面端、终端和子代理会话通过明确的进程与会话关系关联，无法唯一匹配时显示等待状态。

Claude Code 可配合本项目的采集插件补充实时状态。设置步骤见 [setup 命令](https://github.com/Chin-Jing1998/context-lens/blob/v0.11.0/commands/setup.md)；默认静默采集。原有终端 HUD 可通过 `display.showTerminal: true` 启用。

源码目录中的 CLI 可列出会话、持续观察单个会话或启动 Codex：

```sh
node scripts/context-lens.mjs list --client codex --json
node scripts/context-lens.mjs watch --client codex
node scripts/context-lens.mjs codex
```

本地数据服务绑定 `127.0.0.1`。更新检测向 GitHub 查询版本信息，不上传对话或 token 记录。

## 终端 HUD 配置

终端 HUD 配置独立于桌面主题设置。

<details>
<summary>查看完整的终端配置项</summary>

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD 标签语言。设为 `zh` 或 `zh-Hans` 启用简体中文，设为 `zh-Hant` 或 `zh-TW` 启用繁体中文 |
| `lineLayout` | string | `expanded` | 布局：`expanded`（多行）或 `compact`（单行） |
| `showSeparators` | boolean | false | 在 `compact` 布局中，在会话行与活动行之间画一条分隔线 |
| `pathLevels` | 1-3 \| `full` | 1 | 项目路径显示的目录层级数，或设为 `full` 显示完整绝对路径 |
| `maxWidth` | number \| `null` | `null` | 可选的回退宽度，仅在终端宽度检测完全失败时使用 |
| `forceMaxWidth` | boolean | false | 当设置了 `maxWidth` 时始终使用它，即使终端宽度检测返回更小的值 |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","cacheHitRate","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | 展开模式下元素的顺序。省略的条目在展开模式下隐藏。现有配置会保留其显式顺序直到更新 |
| `projectLineOrder` | string[] | `[]` | 可选的首行片段前置顺序，适用于两种布局。可见性仍由 `display.show*` 控制；省略的片段保持渲染器原有顺序。例如 `["project","model"]` 会将项目和 Git 放到模型徽标之前 |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | 展开模式下相邻时应共享一行的元素分组。设为 `[]` 可禁用合并行 |
| `display.rightAlign` | string[] | `[]` | 以合并行中第一个列出的元素作为右对齐后缀的起点，保持 `elementOrder` 并用空格填充间隔。锚点必须位于实际合并渲染的 `display.mergeGroups` 分组中。终端宽度未知、锚点位于首位或空间不足时回退到普通的 ` │ ` 连接。分组为 `["project","context","usage"]` 时设为 `["context"]`，项目/git 保持在左侧，context 与 usage 靠右对齐。 |
| `gitStatus.enabled` | boolean | true | 在 HUD 中显示 git 分支 |
| `gitStatus.showDirty` | boolean | true | 显示 `*` 表示未提交的更改 |
| `gitStatus.showAheadBehind` | boolean | false | 显示 `↑N ↓N` 表示领先/落后远程的提交数 |
| `gitStatus.pushWarningThreshold` | number | 0 | 当未推送提交数达到此值时，用警告色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.pushCriticalThreshold` | number | 0 | 当未推送提交数达到此值时，用严重色显示 ahead 计数（`0` 表示禁用） |
| `gitStatus.showFileStats` | boolean | false | 显示文件变更数量 `!M +A ✘D ?U` |
| `gitStatus.showWorktree` | boolean | false | 在关联的 git worktree 中，于分支后显示其名称，例如 `git:(feat/x) ⎇ feat-x` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | 保持当前截断行为，或在可能时让 git 块以自己的换行边界单独换到下一行 |
| `jjStatus.enabled` | boolean | false | 显式启用 jj（Jujutsu）状态。启用后若找到真实的 `.jj` 目录，该仓库将显示 jj 而不是 git，二者不会同时运行 |
| `jjStatus.showDirty` | boolean | true | 当 jj 工作副本提交与其父提交不同时显示 `*` |
| `jjStatus.showConflicts` | boolean | true | 当 jj 工作副本提交包含未解决冲突时显示 `!conflict` |
| `display.showTerminal` | boolean | false | 终端 HUD 总开关；关闭时初始化及异常均静默，Claude 实时采集独立运行。 |
| `display.showModel` | boolean | true | 显示模型名称 `[Opus]` |
| `display.showProject` | boolean | true | 显示项目路径 |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | 控制模型名称来源。`stdin` 保持默认行为；`auto` 仅在 transcript 返回非 Claude 模型时切换，用于检测代理路由；`transcript` 始终使用 API 响应中的模型。Transcript 模型值会清理终端转义字符并截断为 80 个字符 |
| `display.modelFormat` | `full` \| `compact` \| `short` | `full` | `compact` 去掉 `(1M context)` 这类上下文窗口后缀；`short` 还会去掉开头的 `Claude ` |
| `display.modelOverride` | string | `""` | 用这段文字代替模型名称（最多 80 个字符） |
| `display.showProvider` | boolean | false | 在模型名称*之前*显示提供商标签，例如 `[Bedrock \| Opus 4.6]`。自定义代理提供同名模型时有用。关闭时，自动检测的提供商仍跟在模型后面 |
| `display.providerName` | string | `""` | 与 `display.showProvider` 一起使用的显式提供商标签，例如无法自动检测的自定义代理。为空时回退到自动检测（Bedrock/Vertex/MiniMax/Enterprise）；上限 40 字符 |
| `display.showAddedDirs` | boolean | true | 显示来自 `/add-dir` 的额外工作区目录（如 `+sparkle +lib-foo`）；空数组不显示任何内容。在两种布局中最多渲染 5 个目录（溢出显示为 `+N more`），基名截断为 24 个字符并加 `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` 将目录放在项目名称旁边，每个目录带 `+name` 前缀；`line` 在单独的 `Added dirs: name1, name2` 行渲染（无 `+` 前缀，逗号分隔） |
| `display.showContextBar` | boolean | true | 显示可视化上下文进度条 `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | 上下文显示格式（`45%`、`45k/200k`、剩余 `55%` 或 `45% (45k/200k)`） |
| `display.compactContextFormat` | `full` \| `minimal` | `minimal` | compact 布局中的上下文值格式：`full` 遵循 `contextValue`；`minimal` 始终只显示百分比 |
| `display.autoCompactWindow` | number \| `null` | `null` | 设为正数（如 `200000`）时，按此自动压缩窗口而不是完整模型上下文窗口计算上下文百分比，以匹配 `/context`。留空或 `null` 保持默认全窗口行为 |
| `display.showConfigCounts` | boolean | false | 显示 CLAUDE.md、rules、MCPs、hooks 数量 |
| `display.environmentThreshold` | number | 0 | 配置计数总和达到此值前隐藏（0 = 始终显示） |
| `display.showCost` | boolean | false | 显示 Claude Code 上报的会话费用（`cost.total_cost_usd`） |
| `display.showRoutedCost` | boolean | false | 同时为 Bedrock 和 Vertex 会话显示费用。它们通过云服务商计费，因此 `showCost` 默认隐藏其费用。需同时开启 `showCost` |
| `display.showDailyCost` | boolean | false | 显示当天跨会话累计花费，格式为 `Today $12.34`，从原生 `cost.total_cost_usd` 写入插件数据目录中的按日账本。本地午夜重置。与 `showCost` 独立 |
| `display.showWeeklyCost` | boolean | false | 显示自每周额度窗口开始以来的累计花费，格式为 `Week $123.45`，与 `showDailyCost` 使用同一账本。仅订阅用户可用：需要 7 天用量窗口 |
| `display.showOutputStyle` | boolean | false | 显示当前输出风格，格式为 `style: <名称>` |
| `display.showDuration` | boolean | false | 显示会话已运行的时长，例如 `⏱️ 5m` |
| `display.showSpeed` | boolean | false | 显示最近一次响应的输出 Token 速度 `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | 显示 Claude 订阅用户的使用率限制（可用时） |
| `display.usageDetailMode` | `always` \| `threshold` \| `never` | `threshold` | 显示用量重置倒计时的时机：始终显示、仅在达到 `usageThreshold` 时显示或从不显示 |
| `display.usageValue` | `percent` \| `remaining` | `percent` | 使用率显示格式（已使用 `25%`，或剩余 `75%`） |
| `display.usageBarEnabled` | boolean | true | 将使用率显示为可视化进度条而非文本 |
| `display.usageCompact` | boolean | false | 以较短的文本形式显示使用率，如 `5h: 25% (1h 30m)`；优先于 `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | 在使用率倒计时前显示 `resets in` 前缀 |
| `display.showModelScopedUsage` | boolean | true | 显示按模型每周窗口（`model_scoped`，例如 Fable），无论其来自 stdin 还是外部用量快照。设为 `false` 后，使用率行的渲染效果等同于负载中本就没有这些窗口 |
| `display.usagePace` | boolean | false | 当使用率窗口按当前速度会在重置前用尽时，以琥珀色或红色显示并标记 `▲` |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | 控制使用率窗口时间的显示方式：仅倒计时（`resets in 2h 30m`）、墙钟重置时间（`resets at 14:30`）、两者同时显示、窗口已过百分比（`53% elapsed`），或已过百分比加墙钟重置时间 |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | 墙钟重置时间（`absolute`/`both`/`elapsedAndAbsolute` 模式）的时制。`auto` 跟随系统区域设置；`h23` 强制使用 24 小时制（`14:30`），不受区域设置影响 |
| `display.showClockSeconds` | boolean | false | 在墙钟重置时间中显示秒数，如 `at 14:30:07` |
| `display.usageThreshold` | 0-100 | 0 | 任一窗口达到此百分比前隐藏使用率（0 = 始终显示） |
| `display.sevenDayThreshold` | 0-100 | 80 | 当 7 天使用率 ≥ 阈值时显示（0 = 始终显示） |
| `display.externalUsagePath` | string | `""` | 可选的本地使用率快照文件**绝对路径**。支持开头的 `~` 和 `${VAR}`。相对路径会被忽略。stdin `rate_limits` 存在时会附加 `balance_label`，并在 stdin 缺少 `model_scoped` 窗口时用快照补齐；stdin 窗口缺失时可整体作为回退 |
| `display.externalUsageWritePath` | string | `""` | 可选的绝对 `.json` 路径，父目录必须已存在。支持开头的 `~` 和 `${VAR}`。当 stdin `rate_limits` 存在时，Context Lens 会写入私有权限快照供其他本地工具读取。相对路径、非 json 文件和缺失父目录会被忽略 |
| `display.externalUsageFreshnessMs` | number | `300000` | 外部使用率快照允许的最长存活时间，超时后会被忽略 |
| `display.showTokenBreakdown` | boolean | true | 在高上下文时（85%+）显示 Token 详情 |
| `display.contextDetailMode` | `always` \| `warning` \| `critical` \| `never` | `critical` | Token 明细的显示时机：始终显示、达到警告阈值、仅在严重阈值显示或从不显示 |
| `display.contextWarningThreshold` | 0-100 | 70 | 上下文进度条变为警告色的百分比 |
| `display.contextCriticalThreshold` | 0-100 | 85 | 上下文进度条变为严重色并显示 token 明细的百分比 |
| `display.showTools` | boolean | false | 显示工具活动行 |
| `display.showSkills` | boolean | false | 显示从 `Skill` 工具调用检测到的活动 Skills |
| `display.showMcp` | boolean | false | 显示从 `mcp__server__tool` 调用检测到的活动 MCP 服务器 |
| `display.toolNameMaxLength` | number | `0` | 工具名称最大显示长度。`0` 保留完整名称；截断 MCP 名称时可能缩短为最后一段 |
| `display.toolsMaxVisible` | number | `4` | 工具行最多显示的已完成工具数。`0` 表示不限制 |
| `display.skillsMaxVisible` | number | `4` | Skills 行在 `+N more` 之前最多显示的 Skill 名称数。`0` 表示不限制 |
| `display.showAgents` | boolean | false | 显示 Agent 活动行 |
| `display.showTodos` | boolean | false | 显示待办进度行 |
| `display.showSessionName` | boolean | false | 显示会话名称：`/rename` 设置的名称，或 Claude Code 生成的标题 |
| `display.showSessionTokens` | boolean | false | 显示本会话累计的 token 总量，例如 `Tokens 262k (in: 6k, out: 2k, cache: 254k)` |
| `display.defaultHideSessionTokens` | boolean | true | 即使 `showSessionTokens` 为 true 也隐藏 session token 摘要行；设为 `false` 以显示 |
| `display.showLens` | boolean | false | showTerminal 开启时显示完整分类、主会话及子代理累计和费用；实时采集独立运行。 |
| `display.showAuth` | boolean | false | 在第一行末尾显示当前登录的认证方式（订阅计划），例如 `Claude Max 20x`。来自 `~/.claude.json`（或覆盖配置目录时的 `$CLAUDE_CONFIG_DIR/.claude.json`）的 `oauthAccount`；无 OAuth 但设置了 `ANTHROPIC_API_KEY` 时显示 `API Key` |
| `display.showAuthUser` | boolean | false | 在认证方式旁显示已登录账号（邮箱本地部分，回退到资料显示名） |
| `display.authUserLength` | number | `8` | 账号名截断前的最大字符数，超出以 `…` 截断。`0` 显示全名 |
| `display.showAdvisor` | boolean | false | 在 project 行内联显示 Claude Code `/advisor` 配置的顾问模型，例如 `Advisor: Opus 4.7`。来自 Claude Code 写入每条 assistant transcript 记录的 `advisorModel` 字段；渲染前会做控制字符/双向标记/ANSI 过滤并截断到 64 字符 |
| `display.advisorOverride` | string | `""` | 手动覆盖顾问显示文本。非空时优先于 transcript 检测，同样会做过滤和截断 |
| `display.showSessionStartDate` | boolean | false | 显示 transcript 会话开始时间戳 |
| `display.showLastResponseAt` | boolean | false | 显示最后一次 assistant 响应写入的时间距现在多久 |
| `display.showCompactions` | boolean | false | 显示本会话已发生的上下文压缩次数（手动 `/compact` 或自动压缩），从 transcript 的 `compact_boundary` 记录计数，例如 `压缩次数: 2`。第一次压缩前不显示 |
| `display.showCompactionsOnlyWhenPresent` | boolean | true | 压缩次数为零时隐藏压缩指示器 |
| `display.showGitFilesInCompact` | boolean | false | 在 compact 布局中显示最近变更的 git 文件行（expanded 布局始终显示） |
| `display.showEffortLevel` | boolean | false | 在模型徽章中显示当前推理力度。Ultracode 渲染为 `ultracode(xhigh)`，从会话 transcript 检测，因此能跟踪运行时的 `/effort` 变更 |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | `showEffortLevel` 开启时的渲染方式：符号加级别文本（`◑ high`）、仅符号（`◑`）、或仅级别文本（`high`）。`symbol` 下 Ultracode 仍保持完整的 `◕ ultracode(xhigh)`，以免丢失标记；没有已知符号的级别回退到级别文本 |
| `display.showClaudeCodeVersion` | boolean | false | 显示当前运行的 Claude Code 版本，如 `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | 在展开布局中显示近似系统 RAM 使用行 |
| `display.showPromptCache` | boolean | false | 显示主会话 prompt cache 的过期时刻 |
| `display.showCacheHitRate` | boolean | false | 以 `Cache hit X%` 形式显示本会话的 prompt cache 命中率 |
| `display.customLine` | string | `""` | 显示在第一行的自定义文字（最多 80 个字符） |
| `display.customLinePosition` | `first` \| `last` | `last` | 自定义文字放在第一行的开头还是结尾 |
| `colors.context` | 颜色值 | `green` | 上下文进度条和百分比的基础颜色 |
| `colors.usage` | 颜色值 | `brightBlue` | 使用率进度条和低于警告阈值时百分比的颜色 |
| `colors.warning` | 颜色值 | `yellow` | 上下文阈值和使用率警告文本的警告颜色 |
| `colors.usageWarning` | 颜色值 | `brightMagenta` | 使用率进度条和接近阈值时百分比的警告颜色 |
| `colors.critical` | 颜色值 | `red` | 达到限制状态和严重阈值的颜色 |
| `colors.model` | 颜色值 | `cyan` | 模型徽章颜色，如 `[Opus]` |
| `colors.project` | 颜色值 | `yellow` | 项目路径的颜色 |
| `colors.git` | 颜色值 | `magenta` | Git 包装文本的颜色，如 `git:(` 和 `)` |
| `colors.gitBranch` | 颜色值 | `cyan` | Git 分支和分支状态文本的颜色 |
| `colors.label` | 颜色值 | `dim` | 标签和次要元数据的颜色，如 `Context`、`Usage`、计数和进度文本 |
| `colors.custom` | 颜色值 | `208` | 可选自定义行的颜色 |
| `colors.barFilled` | string | `█` | 进度条填充部分使用的字符 |
| `colors.barEmpty` | string | `░` | 进度条空白部分使用的字符 |

颜色可以是名称（`dim`、`red`、`green`、`yellow`、`magenta`、`cyan`、`brightBlue`、`brightMagenta`）、256 色编号（`0-255`）或十六进制（`#rrggbb`）。`colors.barFilled` 和 `colors.barEmpty` 只接受单个可见字符；emoji 等宽字符在部分终端中可能影响进度条对齐。

</details>

## 从源码构建

构建需要 Node.js 24；macOS 另需 Xcode Command Line Tools。

```sh
git clone --branch main https://github.com/Chin-Jing1998/context-lens.git
cd context-lens
npm ci
npm run build
```

macOS 构建并安装：

```sh
node scripts/build-desktop.mjs --install
```

Windows 构建安装版和便携版：

```sh
npm run build:windows
```

Developer ID 签名、Apple 公证及发布前检查见 [macOS 发布流程](docs/DESKTOP.md#macos-发布签名与公证)。

## 来源与许可

由 [Chin-Jing1998](https://github.com/Chin-Jing1998) 维护，派生自 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)，保留原 MIT 许可和 Git 历史。参见[上游同步说明](UPSTREAM.md)。
