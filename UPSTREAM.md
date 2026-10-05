# 上游同步与本仓库维护

Context Lens 由 Chin-Jing1998 维护，派生自 [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud)。保留完整提交历史与原 MIT 许可。

## 分支与远程

| 名称 | 用途 |
| --- | --- |
| `origin` | `https://github.com/Chin-Jing1998/context-lens.git`，本项目的推送目标 |
| `upstream` | `https://github.com/jarrodwatts/claude-hud.git`，原项目的只读同步源 |
| `main` | 本项目经过验证的改名与功能提交 |
| `codex/hud-multi-client` | 多客户端 HUD 功能开发分支 |

派生基线为 `33b51db6ceb5d0c91dc9c22404abcabacc8603b0`（上游 0.10.0，2026-10-05 核对）。`main` 包含本项目改动，不能通过强制覆盖的方式同步上游。

## 同步上游 main

先确认工作区没有未提交的修改，然后依次运行：

```bash
git status --short
git switch main
git pull --ff-only origin main
git fetch upstream main
git merge --no-edit upstream/main
npm ci
npm test
git push origin main
```

如果 `git merge` 报告冲突，停止后续步骤，先解决冲突并检查 Context Lens 的插件名、安装命令、配置目录、环境变量和仓库链接。保留上游的功能修复，同时保留本项目身份。解决后提交合并、运行测试并推送。不要使用 `reset --hard`、强制推送或 `gh repo sync --force` 替换本项目的提交。

再把通过验证的主分支合入开发分支：

```bash
git switch codex/hud-multi-client
git merge --no-edit main
npm test
git push origin codex/hud-multi-client
```

GitHub 的 Fork 关系提供上游对照与 Sync fork 入口；当改名或功能提交与上游冲突时，使用上述本地合并流程处理。此仓库不配置定时自动合并。

## 重新克隆

```bash
git clone https://github.com/Chin-Jing1998/context-lens.git
cd context-lens
git remote add upstream https://github.com/jarrodwatts/claude-hud.git
git remote set-url --push upstream DISABLED
git config remote.pushDefault origin
gh repo set-default Chin-Jing1998/context-lens
git fetch upstream main
npm ci
npm test
```

`upstream` 的推送地址故意设为 `DISABLED`，避免把本项目改动误推向原作者仓库；拉取地址不受影响。

## 改名与许可证

- 插件与市场标识：`context-lens`。
- 安装和配置命令：`/context-lens:setup`、`/context-lens:configure`。
- HUD 配置：`~/.claude/plugins/context-lens/config.json`；目录覆盖文件：`$CLAUDE_CONFIG_DIR/context-lens.json`。
- 本项目环境变量前缀：`CONTEXT_LENS_`。`CLAUDE_CONFIG_DIR` 属于 Claude Code，自身名称保持原样。
- 现有 Claude HUD 安装与配置不会被本仓库的构建或测试改写。安装 Context Lens 是独立步骤，setup 会备份被替换的状态栏设置。
- `LICENSE`、历史 `CHANGELOG.md` 及原始 Git 提交保留上游归属；这些历史名称不代表当前产品名称。
- 按上游约定，功能提交不纳入生成的 `dist/`；主分支的构建工作流负责更新它。发布前需确认构建工作流已成功。
