<p align="center"><img src="docs/images/context-lens-icon.png" width="96" height="96" alt="Context Lens 应用图标"></p>

# Context Lens

面向 Claude Code、Codex 等 AI 编程工具的本地桌面监测应用。通过悬浮球、七个环形岛和卡片详情，查看会话上下文、用量、费用及工具运行信息。

[English](README.md) · [下载桌面应用](https://github.com/Chin-Jing1998/context-lens/releases/latest) · [安装与使用](docs/DESKTOP.md) · [MIT 许可证](LICENSE)

当前稳定版为 **v0.11.0**。桌面应用源码位于 [codex/hud-multi-client](https://github.com/Chin-Jing1998/context-lens/tree/codex/hud-multi-client) 分支；已发布版本源码位于 [v0.11.0](https://github.com/Chin-Jing1998/context-lens/tree/v0.11.0)。

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

## 从源码构建

构建需要 Node.js 24；macOS 另需 Xcode Command Line Tools。

```sh
git clone --branch codex/hud-multi-client https://github.com/Chin-Jing1998/context-lens.git
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
