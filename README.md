<p align="center"><img src="docs/images/context-lens-icon.png" width="96" height="96" alt="Context Lens application icon"></p>

# Context Lens

A local desktop monitor for Claude Code, Codex and other AI coding tools. A floating ball, seven statistics islands and detail cards show session context, usage, costs and tool activity.

[中文文档](README.zh.md) · [Download](https://github.com/Chin-Jing1998/context-lens/releases/latest) · [Desktop guide](docs/DESKTOP.md) · [MIT license](LICENSE)

The current stable release is **v0.11.0**. Desktop development is on [codex/hud-multi-client](https://github.com/Chin-Jing1998/context-lens/tree/codex/hud-multi-client); the released source is at [v0.11.0](https://github.com/Chin-Jing1998/context-lens/tree/v0.11.0).

## Download and install

Desktop packages include their runtime. A separate Node.js installation is unnecessary.

| Platform | Download | Requirements |
| --- | --- | --- |
| macOS | [Apple Silicon ZIP](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/Context-Lens-0.11.0-mac-arm64.zip) | macOS 13.5 or later, Apple Silicon |
| Windows setup | [Setup exe](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/Context-Lens-0.11.0-win-x64-setup.exe) | Windows 10 or later, x64 |
| Windows portable | [Portable exe](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/Context-Lens-0.11.0-win-x64-portable.exe) | Windows 10 or later, x64 |

[SHA-256 checksums](https://github.com/Chin-Jing1998/context-lens/releases/download/v0.11.0/SHA256SUMS.txt) are included with the release.

### First launch on macOS

Extract the ZIP and move `Context Lens.app` into Applications. **The v0.11.0 macOS package is ad-hoc signed and has not been notarized by Apple.** macOS may block its first launch. After checking the downloaded checksum, use System Settings → Privacy & Security → Open Anyway for Context Lens, then confirm Open. See [Apple's first-launch instructions](https://support.apple.com/102445).

The launch exception and Accessibility permission are separate. To identify foreground sessions, grant Accessibility or device-control permission to the actual installed application.

### Windows launch

The setup package creates desktop and Start menu shortcuts. The portable exe runs directly. The tray menu provides Settings, Show ball, Lock position and Quit.

## Seven statistics islands

| Island | Contents |
| --- | --- |
| Context | Used tokens, window utilization, category and message breakdowns, compaction history |
| Usage | Requests, input, output, cache writes and reads, and available usage limits |
| Costs | Current session, cumulative queries, model costs and per-request billing |
| Commands | Execution counts, status, duration and call history |
| Skills | Skill call counts, names, status and history |
| MCP | MCP tool counts, status, duration and history |
| Session | Runtime and available hook, file, task and linked-agent records |

Only fields supplied by local logs and interfaces are displayed. Unused models and absent categories are hidden. Unknown values remain `—`; derived approximations retain `≈`. Field coverage varies between clients.

## Appearance and controls

- Click the floating ball to expand the islands; select an island to open its details. Escape collapses the panel.
- Choose one of nine fixed themes covering native glass, graphite, porcelain, spectrum, ink, bronze and cyan styles.
- Numbers and English use Times New Roman. Chinese typography follows the selected theme.
- Session windows fit their content. Current-session costs, cumulative queries and per-request bills use separate pages. Long lists offer pagination, filtering, sorting and automatically hidden scrollbars.
- Desktop behavior includes reduced motion and foreground-session recognition.
- About updates checks stable releases from this GitHub repository and links to their downloads.

## Session data

The app reads local Claude Code and Codex session records. Other integrated clients expose the fields available in their local data. Desktop, terminal and linked-agent sessions are associated through explicit process and session evidence; ambiguous matches remain in a waiting state.

The Claude Code collector can supply live status. See the [setup command](https://github.com/Chin-Jing1998/context-lens/blob/v0.11.0/commands/setup.md). Collection is silent by default; `display.showTerminal: true` enables the optional terminal HUD.

The source checkout includes a CLI for listing sessions, watching them or launching Codex:

```sh
node scripts/context-lens.mjs list --client codex --json
node scripts/context-lens.mjs watch --client codex
node scripts/context-lens.mjs codex
```

The local data service binds to `127.0.0.1`. Update checks query GitHub version information without uploading conversations or token records.

## Build from source

Build tools require Node.js 24. macOS also requires Xcode Command Line Tools.

```sh
git clone --branch codex/hud-multi-client https://github.com/Chin-Jing1998/context-lens.git
cd context-lens
npm ci
npm run build
```

Build and install on macOS:

```sh
node scripts/build-desktop.mjs --install
```

Build Windows setup and portable packages:

```sh
npm run build:windows
```

See the [macOS distribution workflow](docs/DESKTOP.md#macos-发布签名与公证) for Developer ID signing, Apple notarization and distribution checks.

## Credits and license

Maintained by [Chin-Jing1998](https://github.com/Chin-Jing1998), derived from [jarrodwatts/claude-hud](https://github.com/jarrodwatts/claude-hud). The original MIT license and Git history are retained. See [upstream synchronization](UPSTREAM.md).
