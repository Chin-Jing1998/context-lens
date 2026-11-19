# Context Lens 桌面应用

Context Lens 以悬浮球和七个环形岛展示当前会话的上下文、用量、费用、命令行、技能、MCP 与运行信息。点击悬浮球展开环形岛，点击各岛打开其详情；按 Escape 收起，设置入口同时位于托盘菜单中。

## 安装

在 [GitHub Releases](https://github.com/Chin-Jing1998/context-lens/releases/latest) 下载对应平台的文件。

| 平台 | 文件 | 系统要求 |
| --- | --- | --- |
| macOS | [Context-Lens-0.14.0-mac-arm64.zip](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.14.0/Context-Lens-0.14.0-mac-arm64.zip) | macOS 13.5 及以上，Apple Silicon |
| Windows 安装版 | [Context-Lens-0.14.0-win-x64-setup.exe](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.14.0/Context-Lens-0.14.0-win-x64-setup.exe) | Windows 10 及以上，x64 |
| Windows 便携版 | [Context-Lens-0.14.0-win-x64-portable.exe](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.14.0/Context-Lens-0.14.0-win-x64-portable.exe) | Windows 10 及以上，x64 |

macOS 将应用放入 Applications 后启动；需要读取前台会话时，在系统设置的“隐私与安全”中为实际安装的 Context Lens 授予辅助功能权限。源码安装运行 `npm ci`、`npm run build` 和 `node scripts/build-desktop.mjs --install`，该方式同时注册登录启动任务。

### macOS 首次打开

v0.14.0 的 macOS 包使用临时签名，尚未通过 Apple 公证。浏览器下载后，macOS 会拦截首次启动并提示无法验证开发者；这与辅助功能授权是两项独立检查。

1. 将 `Context Lens.app` 放入 Applications，尝试打开一次。
2. 打开“系统设置 → 隐私与安全性”，在对应 Context Lens 的拦截记录处选择“仍要打开”，再确认“打开”。这是 [Apple 提供的单个应用启动例外流程](https://support.apple.com/zh-cn/102445)。
3. 应用启动后，再按需授予辅助功能权限以识别前台会话。

发布页同时提供 SHA256SUMS.txt，下载的 ZIP 可以用 `shasum -a 256` 核对。出现“已损坏”时，应先核对校验值及应用签名；只为来源和完整性均已核实的应用设置启动例外。

若系统没有提供“仍要打开”，先确认 ZIP 的 SHA-256 与发布页一致，再核对实际安装路径的签名：

```sh
codesign --verify --deep --strict '/Applications/Context Lens.app'
```

以上两项均通过、且你明确允许当前未公证的应用运行后，可以仅为这个安装副本移除下载隔离标记：

```sh
xattr -dr com.apple.quarantine '/Applications/Context Lens.app'
```

随后重新打开应用。此命令为该应用建立启动例外，不更改系统全局 Gatekeeper 设置；安装在其他目录时，应使用实际应用路径。

Windows 安装版可以选择安装目录并创建桌面及开始菜单快捷方式。便携版可直接启动；两者均自带运行环境。托盘菜单提供设置、显示悬浮球、固定位置和退出操作。

## 主题与布局

设置中的“界面主题”提供原生玻璃、清透玻璃、石墨仪表、白瓷柔光、光谱轨道、墨芯玻璃、水墨宋韵、青铜书卷、青蓝刻度。每个主题固定字体、色彩、材质和动效，直接切换即可。数字和英文采用 Times New Roman，中文按主题采用系统中文、宋体、仿宋或楷体。

会话详情按当前内容调整窗口高度；长记录通过页码、筛选和排序查询。用量页保持固定高度，费用默认展示当前会话，累计查询与逐请求账单各自独立。列表滚动条在操作时显示，停止操作后隐藏。“桌面行为”的减少动效设置适用于环形岛与详情切换。

设置窗口在打开时按屏幕可用区域确定尺寸。切换设置分类和主题时，内容可在窗口内滚动。

### Antigravity

macOS 支持独立 Antigravity 应用和 `agy` CLI。桌面悬浮球跟随前台的 Antigravity 对话。终端内可通过进程会话锁自动识别唯一的 `agy` 会话，也可用 `context-lens list --client agy` 查找会话，再用 `context-lens watch --session agy:<ID>` 查看。源码环境的 AGY 读取使用 Node.js 24 的 SQLite 模块。

会话数据库提供当前上下文预算。`agy` 的原生状态行提供完整窗口时，Context Lens 可读取该窗口和占用率。可在该次 CLI 启动中接入采样：

```sh
agy --settings '{"statusLine":{"type":"command","command":"context-lens agy-statusline","stack_with_default":true}}'
```

每次请求的输入总量包含未缓存输入、缓存读取和缓存写入。界面单列各分项，累计时每次请求只计一次。输出总量包含推理输出。Antigravity 的常规模型请求与压缩请求均计入会话累计。缺失字段显示 `—`。

上下文页使用当前生成快照的分类，可查看系统提示词、系统工具、MCP 工具、技能、规则及对话内容等已上报的占用。对话内容可展开看用户消息、助手回复、工具交互与压缩摘要。命令行、MCP 和技能页按当前会话的执行记录展示调用数量、结果与可用耗时，技能读取按会话实际访问的 `SKILL.md` 计量。

### 第三方模型与单价

自动计价使用 OpenAI、Anthropic、Google、DeepSeek、Xiaomi MiMo 和 Z.ai 的官方 API 美元单价，并按每次请求的模型、时间、服务档位及适用的输入量区间选择。官方仅公布日历日期时，按 UTC 日界线切换单价。费用逐项计算未缓存输入、缓存读取、缓存写入和输出。OpenAI 请求的缓存写入时长未记录时，费用按最低适用写入价计算下限。上下文容量采用当前会话实际上报的窗口。

自定义单价保存在 `~/.config/context-lens/config.json` 的 `prices` 中。设置 `CONTEXT_LENS_HOME` 时使用该目录下的 `config.json`。按响应模型完整标识填写 `input`、`output`、`cacheRead`、`cacheWrite`，每项单位为配置币种金额／百万 token。`input` 对应未缓存输入。计价依次匹配精确模型单价、`*` 通配单价和官方单价。显式 `0` 表示免费。

若悬浮球显示“等待对话”，应先检查当前对话是否已被定位，而不是先修改模型名或单价。macOS 的 Claude Desktop 会话识别支持 `/code/local_…` 与 `/epitaxy/local_…` 路由，并排除本地桌面壳层；多个实际会话页面仍视为歧义，不会选择最近更新的日志代替当前对话。

Claude 的悬浮球、上下文详情与设置预览主读数均表示当前会话的上下文窗口占用率，优先使用同一会话最新状态栏采样中的 `context_window.used_percentage`；缺少有效原生占比时，使用最后一次请求的完整输入 token 数除以实际上报的窗口容量，不累加历史请求或输出 token。首次响应、压缩后的零占位以及过期、跨会话数据不能覆盖有效读数。没有可靠占比或容量时显示未知，token 数只保留在详情中。

压缩预算作为独立字段展示，手动预算不会改写主读数的窗口分母。分类数据保留所选的预算或窗口口径。状态栏采样与结构化 `/context` 记录均未提供容量时，窗口读数保持未知。

Desktop / SDK 会话没有实时采样，并不等于状态栏命令未配置。应分别核对当前会话的采样文件与客户端是否执行采集命令；后台费用记录可以独立更新，费用更新不能证明实时采集正常。

## 更新

“设置 → 关于更新 → 检测更新”查询 [Chin-Jing1998/context-lens](https://github.com/Chin-Jing1998/context-lens) 的最新正式 Release。发现新版本后，点击 GitHub 版本入口下载对应文件；检测过程不上传对话、token 记录或本地配置。

## 从源码构建

桌面构建源码位于 [main](https://github.com/Chin-Jing1998/context-lens/tree/main) 分支。构建工具使用 Node.js 24。运行 `npm ci` 和 `npm run build` 后，macOS 执行 `node scripts/build-desktop.mjs`，Windows 执行 `npm run build:windows`。图标资源由 `npm run build:icons` 从同一个 SVG 生成。

GitHub Actions 的 CI 工作流提供 macOS ZIP，Windows desktop 工作流提供 Windows 安装版与便携版。构建产物均附带 SHA-256 校验文件，版本号来自 `package.json`。源码构建产物与 Releases 中的正式发布包分别提供。

Windows 桌面基于 [Electron 的 Windows 10 及以上平台支持](https://github.com/electron/electron#platform-support)。构建流程生成 NSIS 安装版和便携版，并启动打包后的程序核验本地服务与界面入口。

### macOS 发布签名与公证

面向浏览器下载的 macOS 发布包需要 [Developer ID 签名与 Apple 公证](https://developer.apple.com/developer-id/)。在构建环境中设置 `CONTEXT_LENS_MAC_SIGNING_IDENTITY` 为钥匙串中有效的 Developer ID Application 身份，设置 `CONTEXT_LENS_MAC_NOTARY_PROFILE` 为已通过 `notarytool store-credentials` 保存的钥匙串配置名称，然后运行：

```sh
node scripts/build-desktop.mjs --notarize
```

该流程先对内置 Node.js 与应用启用 Hardened Runtime 并签名，再提交公证。只有 Apple 返回 Accepted、公证票据附加和校验成功、Gatekeeper 检查通过后，流程才成功结束。打包 ZIP 必须在这些步骤完成之后进行。没有签名身份时，常规源码构建仍使用临时签名，并明确输出其分发限制。
