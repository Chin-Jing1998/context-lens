# Liquid Glass 界面重构与验收

日期：2026-10-05。范围：AppKit 悬浮球、WKWebView 面板及共享网页。测试数据均来自隔离的合成会话，不代表用户实际用量或实际模型费率。

## 实现结果

- 56 pt 圆球使用细进度环与 Times New Roman 数字；客户端名称移至悬停提示。macOS 26+ 使用 `NSGlassEffectView`，旧系统保留 `NSVisualEffectView` 分支。应用声明的运行下限仍为 macOS 13.5。
- 面板初始内容为 420 × 620 pt，最小 360 × 480 pt；保存尺寸与圆球位置，打开时定位到圆球附近，并按当前屏幕可见区域限制尺寸和位置。
- 概览区分当前主会话上下文与主会话、子代理的累计统计；分类与来源、累计明细、会话元数据按需展开。累计明细保留 10 个指标，使用主会话／子代理／合计三列。
- 设置分成显示与模型价格。价格按模型展开六项费率，保留 `*` 默认模型、零价格和留空的含义。错误关联具体输入项；连接或保存失败保留草稿。
- 主题、间距、圆角、字号、边框、控件状态共用语义变量。正文为系统字体，数字与费率为 Times New Roman。玻璃效果集中于入口、工具栏和弹窗，统计卡片使用稳定底色。
- `LensVisibility` 集中管理显示状态；轮询、后台连接和迟到响应只更新数据，不负责显示窗口。手动隐藏不会被菜单焦点返回撤销；主动打开覆盖当前隐藏状态，之后按外部应用切换继续跟随。
- WebView 消息桥保留主 frame、协议、主机和端口检查，新增主题、辅助功能、收起、隐藏及设置命令。Escape 先关闭当前弹窗并恢复触发按钮焦点，再收起主面板。
- 未修改 HTTP 接口、`HudSnapshot`、统计与费用算法、价格配置格式及 CLI 默认输出。

## 执行环境与结果

本机：macOS 27.2，Apple Silicon，macOS SDK 26.2，Node.js 24.15.0。独立预览应用使用 `io.github.Chin-Jing1998.context-lens.preview` 偏好域，测试 HTTP 服务监听 `127.0.0.1:47932`，配置位于 `mkdtemp` 创建的临时目录。

| 验证 | 状态 | 依据 |
| --- | --- | --- |
| `npm test` | PASS | 395 项，390 通过、5 跳过、0 失败；包含原有统计、费率、HTTP 边界及 CLI 回归 |
| 原生编译 | PASS | macOS 26.2 SDK 编译成功，保留旧系统 availability 分支 |
| `--self-test` | PASS | 会话标识、负坐标屏幕边界、过大面板收缩、显示状态转换、菜单焦点返回、主动恢复 |
| ad-hoc 签名校验 | PASS | `codesign --verify --deep --strict` 成功；没有新增 Apple 公证声明 |
| 两种占比口径 | PASS | 合成 80k／200k 为 40.0%，模型窗口 256k 为 31.3% |
| 会话搜索与固定 | PASS | 输入 Claude 过滤到对应分组，选择后显示“已固定”；自动跟随开关可恢复定位 |
| 多候选、空列表 | PASS | 多候选不猜选，显示手动选择提示；空列表显示未发现本地会话 |
| 未知、估算、缺少价格 | PASS | 占比显示“—”，估算及未知分类提示留在概览，费用显示未配置；累计不完整提示可见 |
| 超限 | PASS | 220k／200k 显示 110.0%，进度条容器不造成横向溢出 |
| 断线 | PASS | 保留上次 110.0% 结果，同时显示连接中断，未用零值替换 |
| 价格验证与失败恢复 | PASS | 负数错误定位字段；503 保存失败后模型、0 与 20 的输入仍在；恢复服务后可保存 |
| 价格格式兼容 | PASS | 在隔离配置中实际保存 `*`，读取文件确认 input=0、output=20、空 cacheRead 不写入 |
| 长文本与焦点 | PASS | 长模型名换行；多个轮询周期后焦点仍在“输出”，输入仍为 20，弹窗滚动位置未变化 |
| 原生 Escape 顺序 | PASS | WKWebView 第一次 Escape 仅关闭设置，焦点回到设置按钮；第二次才收起面板 |
| 原生草稿恢复 | PASS | 将输出改为 23.5，关闭弹窗、收起、切到 Chrome 隐藏，再打开后仍为 23.5 且标记未保存 |
| 手动隐藏与刷新 | PASS | 原生审计连续记录 ball=false、panel=false、ballVisible=false、panelVisible=false；16 秒后及断线轮询后均未重新出现 |
| 离开支持应用 | PASS | 将 Chrome 窗口置前后，原生记录前台 com.google.Chrome、圆球与面板均不可见 |
| 主动恢复 | PASS | 主动重新打开后圆球与面板立即恢复，保留 WebView 状态 |
| 返回支持应用 | PASS（状态转换） | 自检覆盖外部无关应用→原支持应用、支持应用间切换及同一应用菜单返回；真实全局焦点回切见下方限制 |
| 浏览器尺寸 | PASS | Chromium 内置浏览器检查 320／420／768／1440 CSS px，无横向溢出；768 起为两列 |
| WKWebView 尺寸 | PASS | 独立偏好域配置 320／420／768／1440 pt 并启动实际 WebKit；等待统计网格完成布局后读取尺寸，320 被限制为 360，其余保持请求尺寸；均无横向溢出，深色数字字体仍为 Times New Roman |
| 200% 放大 | PASS（CSS zoom） | 768 × 900 视口下以 CSS zoom=2 检查设置与选择弹窗；修正后选择器边界为 x=38…743、y=170…876，位于视口内；检查后撤销缩放 |
| 深浅外观 | PASS | Chromium 与 WKWebView 切换外观，Times New Roman 数字样式生效；fgcap 实际渲染留档 |
| 减少动态、透明度、增强对比度 | PASS（浏览器模拟） | DevTools 媒体偏好模拟：animation=none、backdrop-filter=none、辅助文字改为正文颜色；随后恢复模拟设置 |

浏览器的 320／420／768／1440 验收采用响应式视口。原生 320 pt 请求应被限制为 360 pt，这是设计中的最小窗口约束，不是 320 pt 原生窗口支持声明。WKWebView 尺寸诊断记录保存在本地 `desktop/build/ui-validation/wk-width-matrix.json`。

## 未执行与边界

- `NOT_EXECUTED`：macOS 13.5 和 14–25 真机材质回退、Intel 真机、多个物理显示器切换、重启后的登录自动启动、所有第三方终端。
- `NOT_EXECUTED`：Safari 独立浏览器、VoiceOver 完整朗读遍历、实体触控设备、系统设置中实际切换三项辅助功能，以及浏览器菜单的原生 200% 缩放。CSS zoom 与媒体偏好模拟不冒充这些真机操作。
- Chrome 扩展控制的独立浏览器对验收地址返回 `ERR_BLOCKED_BY_CLIENT`，未绕过拦截；浏览器功能验收改在允许访问本地服务的 Chromium 内置浏览器执行。
- 真实全局焦点从 Chrome 返回 Codex／Terminal 的专门自动化操作为 `NOT_EXECUTED`：工具拒绝控制这两个应用。相关状态转换通过原生自检；离开支持应用和主动恢复已实测。
- 原生窗口截图在当前捕获环境中未作为独立可捕获窗口枚举出来，因此使用 fgcap 区域捕获留存 WKWebView 实际渲染。原生价格图包含其他悬浮控件遮挡，不能作为无遮挡全界面视觉证明。网页概览使用 fgcap 的宿主窗口捕获，不含其他浮窗覆盖。

## 可重复的回归步骤

先执行 `npm run build`，再运行 `node tests/fixtures/lens-ui-server.mjs 47932`。服务生成自己的临时配置，退出时清理该目录；不读取个人会话。仅开发用控制端点接受终端请求，拒绝带浏览器 Origin／Sec-Fetch-Site 的请求。

```sh
curl -fsS -X POST http://127.0.0.1:47932/__test/state \
  -H 'Content-Type: application/json' \
  --data '{"scenario":"unknown","saveFailure":false,"delayed":false}'
```

`scenario` 可使用 `normal`、`unknown`、`over`、`multiple`、`empty`、`offline`；`saveFailure=true` 模拟保存失败，`delayed=true` 延迟快照以检查迟到响应。这里的金额由夹具固定，仅验证显示与配置传输；实际费用算法以现有自动测试为依据。

1. 在网页及预览应用中切换口径、搜索会话、关闭自动跟随后重新选择当前会话；重新载入应继续显示已固定。
2. 展开分类和累计明细，滚动并将焦点放入价格字段，等待多个轮询周期；展开状态、焦点、滚动和输入不得重置。
3. 输入负数验证字段错误，再输入 0 与空值。模拟 503 后保存，检查草稿保留；恢复服务后保存并检查临时配置文件。
4. 打开设置，按一次 Escape 检查仅关闭弹窗及焦点恢复，再按一次检查收起面板。弹窗背景点击应关闭弹窗；从弹窗内部拖至外部不应误关闭。
5. 手动隐藏后等待轮询、断线与延迟响应，窗口不得重新显示。经无关应用进入支持应用只恢复圆球；本应用菜单焦点返回不得撤销隐藏。
6. 用独立预览 bundle 测原生界面，不安装端口 47932 的夹具应用。预览应用可加 `--ui-audit /绝对路径/记录.json`，每次轮询写入可见状态、尺寸和 DOM 布局诊断；正常启动不生成此文件，也不记录会话正文或价格值。

## 本地证据与参考

`desktop/build/ui-validation/` 保存测试日志、原生尺寸记录、配置指纹与 fgcap 截图。该目录随构建产物忽略，不提交个人界面和应用包。

- `overview-light.png`：浅色概览，合成数据。
- `overview-dark-verified.png`：深色概览，合成数据。
- `native-prices.png`：WKWebView 六项费率与保留的 23.5 草稿。
- `npm-test.log`、`native-build.log`：本轮执行记录。

官方参考：[Apple Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)。正文、来源、抓取日期和提取方法存入 `web-archive/liquid-glass_20261005/`。markflow 初次返回标题壳，已保留并注明覆盖不足；随后用 scrapling 的真实 Chrome 渲染抓取 `main` 正文。尺寸、字号及 Times New Roman 数字是本项目约定，不冒充 Apple 强制规范。

## 安装交付

已使用现有安装器更新 `~/Applications/Context Lens.app`。安装后的副本再次通过自检与签名检查；LaunchAgent 为 running，PID 41147（验收时）；47831 端口的健康接口返回协议 1，打包配置没有测试 home 覆盖。

- 旧应用：`~/Applications/Context Lens.previous-1791183397394.app`。
- LaunchAgent 备份：`~/Library/LaunchAgents/io.github.Chin-Jing1998.context-lens.plist.backup-1791183397481`。
- `~/.config/context-lens/config.json`、`~/.claude/settings.json`、`~/.codex/config.toml` 的安装前后 SHA-256 指纹一致；测试价格未写入用户配置。
- 已实际打开安装后的新版圆球与面板，确认读取当前 Codex 会话、显示估算和未知分类提示，且主会话上下文与累计输入输出分区正确。

验收完成后关闭临时页面、停止隔离服务并恢复浏览器视口与媒体偏好。测试预览应用和本地证据保留在忽略的构建目录中；未推送源码或创建发布版本。
