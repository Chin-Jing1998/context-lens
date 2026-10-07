# Context Lens 桌面应用

Context Lens 以悬浮球和七个环形岛展示当前会话的上下文、用量、费用、命令行、技能、MCP 与运行信息。点击悬浮球展开环形岛，点击各岛打开其详情；按 Escape 收起，设置入口同时位于托盘菜单中。

## 安装

在 [GitHub Releases](https://github.com/Chin-Jing1998/context-lens/releases/latest) 下载对应平台的文件。

| 平台 | 文件 | 系统要求 |
| --- | --- | --- |
| macOS | Context-Lens-0.11.0-mac-arm64.zip | macOS 13.5 及以上，Apple Silicon |
| Windows 安装版 | Context-Lens-0.11.0-win-x64-setup.exe | Windows 10 及以上，x64 |
| Windows 便携版 | Context-Lens-0.11.0-win-x64-portable.exe | Windows 10 及以上，x64 |

macOS 将应用放入 Applications 后启动；需要读取前台会话时，在系统设置的“隐私与安全”中为实际安装的 Context Lens 授予辅助功能权限。源码安装运行 `npm ci`、`npm run build` 和 `node scripts/build-desktop.mjs --install`，该方式同时注册登录启动任务。

Windows 安装版可以选择安装目录并创建桌面及开始菜单快捷方式。便携版可直接启动；两者均自带运行环境。托盘菜单提供设置、显示悬浮球、固定位置和退出操作。

## 主题与布局

设置中的“界面主题”提供原生玻璃、清透玻璃、石墨仪表、白瓷柔光、光谱轨道、墨芯玻璃、水墨宋韵、青铜书卷、青蓝刻度。每个主题固定字体、色彩、材质和动效，直接切换即可。数字和英文采用 Times New Roman，中文按主题采用系统中文、宋体、仿宋或楷体。

会话详情按当前内容调整窗口高度；长记录通过页码、筛选和排序查询。用量页保持固定高度，费用默认展示当前会话，累计查询与逐请求账单各自独立。列表滚动条在操作时显示，停止操作后隐藏。“桌面行为”的减少动效设置适用于环形岛与详情切换。

## 更新

“设置 → 关于更新 → 检测更新”查询 [Chin-Jing1998/context-lens](https://github.com/Chin-Jing1998/context-lens) 的最新正式 Release。发现新版本后，点击 GitHub 版本入口下载对应文件；检测过程不上传对话、token 记录或本地配置。

## 从源码构建

构建工具使用 Node.js 24。运行 `npm ci` 和 `npm run build` 后，macOS 执行 `node scripts/build-desktop.mjs`，Windows 执行 `npm run build:windows`。图标资源由 `npm run build:icons` 从同一个 SVG 生成。

Windows 桌面基于 [Electron 的 Windows 10 及以上平台支持](https://github.com/electron/electron#platform-support)。构建流程生成 NSIS 安装版和便携版，并启动打包后的程序核验本地服务与界面入口。
