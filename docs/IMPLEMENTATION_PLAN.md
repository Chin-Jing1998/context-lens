# Context Lens 多客户端 HUD 实施计划

确认日期：2026-10-05。

本文件保存已确认的功能范围及实施记录。仓库保留上游历史；新增统计、网页、CLI 接入和独立 macOS 应用均已实现。使用方法与边界见 [USAGE.md](USAGE.md)。

## 已确认的交互与统计口径

- Claude Code CLI 使用原生 statusLine。
- Codex CLI 保留官方程序和原位置内置指标，完整统计查看悬浮球；不采用 tmux 分屏或修改官方源码。
- 独立 macOS 悬浮球同时用于桌面端和 CLI，可拖动、置顶、展开；登录监听在 Claude、Codex 桌面端或终端激活时显示，并定位唯一可确认的活跃会话。多候选时提示选择。本期不包含无本地日志的普通 Chat、Cowork 或云端会话。
- 占比默认以用户设置的 autocompact token 预算为 100%。例如已用 80k、预算 200k，主占比为 40%；另提供模型全窗口视图。
- 分类数据优先采用客户端报告，可确认已加载的内容允许明确标注的 tokenizer 估算；未知内容单列。
- 累计统计包含当前主会话及其子代理，分列主会话、子代理和合计。
- 缓存状态指提示词缓存是否建立、仍有效或已过期；缺少证据时显示未知。

## 1. 上下文预算与分类占用 — 已实现

自动解析 Claude 的环境变量、启动覆盖、模型专属 `modelSettings`、顶层 `autoCompactWindow` 与配置作用域；Codex 解析 `model_auto_compact_token_limit`、profile 和启动覆盖。显示采用值及来源，无法确认运行时生效值时明确标注。

配置变化、模型切换或压缩后重新计算。关闭自动压缩时使用模型容量。预算内缓冲采用 `Free = max(预算 - 已用 - 缓冲, 0)`；预算外预留仅在模型全窗口视图中计算。缓冲未知时不能按零处理。Codex 的 `body_after_prefix` 口径只有在能获得对应基线时计算，否则显示不可用。

分段包括 MCP tools、System tools、Skills、System prompt、Memory files、MCP server instructions、Autocompact buffer、Free space、对话内容及未分类占用。每类具有固定区分色、token 数、百分比、来源与更新时间。已安装不等于已注入，不扫描全部配置后冒充当前实际占用。分类合计冲突时显示差额或冲突，不强制缩放掩盖。压缩后等待新的有效数据。

## 2. 累计 token 与缓存 — 已实现

Claude 按响应 ID 去重累计 usage；Codex 优先采用带响应 ID 的 `token_usage_record`，兼容旧版累计快照。通过明确父子会话关系关联子代理，排除重复记录与继承历史，不通过目录相同推定父子关系。

显示累计输入、输出、缓存写入、缓存读取及缓存读取次数。输入包含缓存部分；推理输出是输出子项，不重复相加。缓存读取次数为缓存读取 token 大于零的去重请求数；旧日志无法确定时标注不完整。命中率为累计缓存读取 token 除以累计全部输入 token，合计使用加权值。

优先使用客户端的缓存有效期；推算必须标注。Codex 过去一次请求命中不能证明缓存现在仍有效。恢复、日志重复、流式更新、截断和压缩均不得造成重复累计。

## 3. 自定义价格 — 已实现

提供表单与 JSON 配置，设置币种和每百万 token 的输入、输出、缓存读取及缓存写入价格；Claude 写入支持区分 5 分钟和 1 小时。按每次请求的实际模型计算，保留客户端报告费用，自定义结果明确标为估算。缺少价格时显示未配置或部分估算，不能默认为零。修改价格后重算当前会话估算。

## 4. 共用接口与客户端接入 — 已实现

新增 `HudSnapshot`，包含会话身份、上下文、分类、累计统计、缓存、费用、来源、精度和时间。新增 `context-lens watch`、`context-lens codex -- <原生参数>`、`context-lens serve`；原 statusLine 调用方式继续可用。

终端监看通过明确 session ID 绑定，无法可靠识别时显示选择器。网页采用原生 HTML/CSS/TypeScript 与 Node HTTP，只监听回环地址，提供会话选择、展开分类、价格编辑和自动刷新。接口返回监测数据，不返回完整提示词或对话正文；校验来源、会话标识及价格。读取配置使用 `smol-toml`，本地估算使用 `js-tiktoken`；非对应模型编码器的结果标为近似。

新增完整显示通过配置启用，保留现有默认两行布局。所有文档、界面、命令和配置使用 Context Lens 品牌。

独立应用采用 Swift/AppKit/WKWebView，携带本地 Node.js 运行环境和生产依赖，安装后无需仓库。活跃会话定位依据运行进程归属，不把最近修改的历史日志当成当前会话。当前原生悬浮球支持 macOS；其他平台继续使用终端与网页。

## 验收与来源

已执行的检查和未执行边界见 [VALIDATION.md](VALIDATION.md)。

- 预算：80k/200k=40%；修改设置、覆盖优先级、关闭自动压缩、模型切换、缓冲未知、预算超限。
- 统计：流式去重、响应重放、恢复、压缩、截断、父子会话、继承基线、加权缓存命中率。
- 费用：混合模型、缺少价格、价格调整、缓存写入类型、推理输出不重复计费。
- 客户端：四端真实展示、窄窗口、深浅主题、会话切换、无数据、断线；桌面截图经 fgcap 核验，未执行项目保留 `NOT_EXECUTED`。
- 回归：`npm test`、相关输出快照、输入校验及同源限制检查。

核对来源：

- [上游仓库](https://github.com/jarrodwatts/claude-hud)
- [Claude statusLine 字段](https://code.claude.com/docs/en/statusline)
- [Claude autocompact 配置](https://code.claude.com/docs/en/model-config#set-the-auto-compact-window)
- [Claude Desktop 预览](https://code.claude.com/docs/en/desktop#preview-your-app)
- [Codex 配置](https://learn.chatgpt.com/docs/config-file/config-reference)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Codex 内置浏览器](https://learn.chatgpt.com/docs/browser)

检索正文与索引只保存在本地 `web-archive/`，不随代码发布。
