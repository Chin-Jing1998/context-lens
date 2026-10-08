<p align="center"><img src="docs/images/context-lens-icon.png" width="96" height="96" alt="Context Lens application icon"></p>

# Context Lens

A local desktop monitor for Claude Code, Codex and other AI coding tools. A floating ball, seven statistics islands and detail cards show session context, usage, costs and tool activity.

[中文文档](README.zh.md) · [Download](https://github.com/Chin-Jing1998/context-lens/releases/latest) · [Desktop guide](docs/DESKTOP.md) · [MIT license](LICENSE)

The current stable release is **v0.11.0**. Desktop application source is on [main](https://github.com/Chin-Jing1998/context-lens/tree/main); the released source is at [v0.11.0](https://github.com/Chin-Jing1998/context-lens/tree/v0.11.0).

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

## Terminal HUD configuration

Terminal HUD configuration is separate from desktop theme settings.

<details>
<summary>All terminal configuration options</summary>

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `language` | `en` \| `zh` \| `zh-Hans` \| `zh-Hant` \| `zh-TW` | `en` | HUD label language. Use `zh` or `zh-Hans` for Simplified Chinese and `zh-Hant` or `zh-TW` for Traditional Chinese. |
| `lineLayout` | string | `expanded` | Layout: `expanded` (multi-line) or `compact` (single line) |
| `showSeparators` | boolean | false | In `compact` layout, draw a rule between the session line and the activity lines |
| `pathLevels` | 1-3 \| `full` | 1 | Directory levels to show in project path, or `full` to show the entire absolute path |
| `maxWidth` | number \| `null` | `null` | Optional fallback width used only when terminal width detection fails completely |
| `forceMaxWidth` | boolean | false | Always use `maxWidth` when it is set, even if terminal width detection returns a smaller value |
| `elementOrder` | string[] | `["project","addedDirs","context","usage","promptCache","cacheHitRate","memory","environment","tools","skills","mcp","agents","todos","sessionTime"]` | Expanded-mode element order. Omit entries to hide them in expanded mode. Existing configs keep their explicit order until updated. |
| `projectLineOrder` | string[] | `[]` | Optional leading order of segments *within* the first line, in both layouts. Visibility stays with the `display.show*` flags, and omitted segments retain their existing renderer order. `model` covers provider + model + effort (plus the context bar in compact mode); `project` covers path + added dirs + git as one segment. Example: `["project","model"]` puts the project/git block before the model badge. |
| `display.mergeGroups` | string[][] | `[["context","usage"]]` | Expanded-mode groups that should share a line when adjacent. Set `[]` to disable merged lines. |
| `display.rightAlign` | string[] | `[]` | Starts a right-aligned suffix at the first listed element in a merged row, preserving `elementOrder` and padding the gap with spaces. Requires the anchor to be in a `display.mergeGroups` group that actually renders on one line. Ignored when the terminal width is unknown, the anchor is first, or there is no room for padding. Example: `["context"]` with a `["project","context","usage"]` group keeps project/git left and pins context + usage right. |
| `gitStatus.enabled` | boolean | true | Show git branch in HUD |
| `gitStatus.showDirty` | boolean | true | Show `*` for uncommitted changes |
| `gitStatus.showAheadBehind` | boolean | false | Show `↑N ↓N` for ahead/behind remote |
| `gitStatus.pushWarningThreshold` | number | 0 | Color the ahead count with the warning color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.pushCriticalThreshold` | number | 0 | Color the ahead count with the critical color at or above this unpushed-commit count (`0` disables it) |
| `gitStatus.showFileStats` | boolean | false | Show file change counts `!M +A ✘D ?U` |
| `gitStatus.showWorktree` | boolean | false | In a linked git worktree, show its name after the branch, e.g. `git:(feat/x) ⎇ feat-x` |
| `gitStatus.branchOverflow` | `truncate` \| `wrap` | `truncate` | Keep current truncation behavior or let the git block wrap onto its own line boundary when possible |
| `jjStatus.enabled` | boolean | false | Opt in to jj (Jujutsu) status. When enabled and a real `.jj` directory is found, jj is used instead of git for that repo — never both |
| `jjStatus.showDirty` | boolean | true | Show `*` when the working-copy commit differs from its parent |
| `jjStatus.showConflicts` | boolean | true | Show a `!conflict` marker when the working-copy commit has an unresolved conflict |
| `display.showTerminal` | boolean | false | Enable terminal HUD output. Live Claude counters are captured independently; false also suppresses initialization and error output. |
| `display.showModel` | boolean | true | Show model name `[Opus]` |
| `display.showProject` | boolean | true | Show the project path |
| `display.modelSource` | `stdin` \| `auto` \| `transcript` | `stdin` | Controls which source the model name comes from. `stdin` preserves the default behavior and always uses what Claude Code reports. `auto` opts into proxy redirect detection by using transcript models only for non-Claude models. `transcript` always uses the model from the API response. Transcript model values are terminal-sanitized and capped at 80 characters |
| `display.modelFormat` | `full` \| `compact` \| `short` | `full` | `compact` drops a context-window suffix such as `(1M context)`; `short` also drops a leading `Claude ` |
| `display.modelOverride` | string | `""` | Show this text instead of the model name (80 characters max) |
| `display.showProvider` | boolean | false | Show the provider label *before* the model name, e.g. `[Bedrock \| Opus 4.6]`. Useful when a custom proxy serves identically-named models from different providers. When off, an auto-detected provider still trails the model as before |
| `display.providerName` | string | `""` | Explicit provider label used with `display.showProvider`, e.g. for a custom proxy that can't be auto-detected. Falls back to the auto-detected provider (Bedrock/Vertex/MiniMax/Enterprise) when empty; capped at 40 chars |
| `display.showAddedDirs` | boolean | true | Show extra workspace directories from `/add-dir` (e.g. `+sparkle +lib-foo`); empty array renders nothing. In both layouts at most 5 dirs render (overflow shown as `+N more`) and basenames are truncated to 24 chars with `…` |
| `display.addedDirsLayout` | `inline` \| `line` | `inline` | `inline` puts dirs next to the project name with a `+name` prefix per dir; `line` renders them on a separate `Added dirs: name1, name2` line (no `+` prefix, comma-separated) |
| `display.showContextBar` | boolean | true | Show visual context bar `████░░░░░░` |
| `display.contextValue` | `percent` \| `tokens` \| `remaining` \| `both` | `percent` | Context display format (`45%`, `45k/200k`, `55%` remaining, or `45% (45k/200k)`) |
| `display.compactContextFormat` | `full` \| `minimal` | `minimal` | Context value format in compact layout: `full` respects `contextValue`; `minimal` always shows only a percentage |
| `display.autoCompactWindow` | number \| `null` | `null` | When set to a positive number such as `200000`, compute the context percentage against this auto-compact window instead of the full model context window, matching the `/context` figure. Leave unset or `null` to preserve default full-window behavior. |
| `display.showConfigCounts` | boolean | false | Show CLAUDE.md, rules, MCPs, hooks counts |
| `display.environmentThreshold` | number | 0 | Hide the config counts until their total reaches this number (0 = always show) |
| `display.showCost` | boolean | false | Show the session cost Claude Code reports (`cost.total_cost_usd`) |
| `display.showRoutedCost` | boolean | false | Also show cost for Bedrock and Vertex sessions, which `showCost` hides because they bill through the cloud provider. Requires `showCost` |
| `display.showDailyCost` | boolean | false | Show today's cumulative spend across sessions as `Today $12.34`, accumulated from the native `cost.total_cost_usd` into a small per-day ledger in the plugin data directory. Resets at local midnight. Independent of `showCost` |
| `display.showWeeklyCost` | boolean | false | Show spend since the weekly quota window opened as `Week $123.45`, from the same ledger as `showDailyCost`. Subscribers only: needs the 7-day usage window |
| `display.showOutputStyle` | boolean | false | Show the current output style as `style: <name>` |
| `display.showDuration` | boolean | false | Show how long the session has been running, e.g. `⏱️ 5m` |
| `display.showSpeed` | boolean | false | Show the latest response's output speed `out: 42.1 tok/s` |
| `display.showUsage` | boolean | true | Show Claude subscriber usage limits when available |
| `display.usageDetailMode` | `always` \| `threshold` \| `never` | `threshold` | When to show the usage reset countdown: always, only when the window reaches the `usageThreshold`, or never |
| `display.usageValue` | `percent` \| `remaining` | `percent` | Usage display format (`25%` used, or `75%` remaining) |
| `display.usageBarEnabled` | boolean | true | Display usage as visual bar instead of text |
| `display.usageCompact` | boolean | false | Display usage in a shorter text form such as `5h: 25% (1h 30m)`; takes precedence over `display.usageBarEnabled` |
| `display.showResetLabel` | boolean | true | Show the `resets in` prefix before usage countdowns |
| `display.showModelScopedUsage` | boolean | true | Show the per-model weekly windows (`model_scoped`, e.g. Fable), whether they arrive on stdin or from the external usage snapshot. Set to `false` to render the usage line as if the payload carried none of them |
| `display.usagePace` | boolean | false | Colour usage windows amber or red, marked `▲`, when they are on track to run out before they reset |
| `display.timeFormat` | `relative` \| `absolute` \| `both` \| `elapsed` \| `elapsedAndAbsolute` | `relative` | How usage-window time is shown: countdown only (`resets in 2h 30m`), wall-clock reset (`resets at 14:30`), both, elapsed window percentage (`53% elapsed`), or elapsed plus wall-clock reset |
| `display.hourCycle` | `auto` \| `h11` \| `h12` \| `h23` \| `h24` | `auto` | Hour cycle for wall-clock reset times (`absolute`/`both`/`elapsedAndAbsolute` modes). `auto` defers to the system locale; `h23` forces 24-hour time (`14:30`) regardless of locale |
| `display.showClockSeconds` | boolean | false | Show seconds in wall-clock reset times, e.g. `at 14:30:07` |
| `display.usageThreshold` | 0-100 | 0 | Hide the usage display until either window reaches this percentage (0 = always show) |
| `display.sevenDayThreshold` | 0-100 | 80 | Show 7-day usage when >= threshold (0 = always) |
| `display.externalUsagePath` | string | `""` | Optional absolute path to a local usage snapshot file. A leading `~` and `${VAR}` are expanded. Relative paths are ignored. When stdin `rate_limits` are present, `balance_label` is appended and `model_scoped` windows fill in when stdin lacks them; when stdin windows are missing, valid usage windows can be used as a fallback |
| `display.externalUsageWritePath` | string | `""` | Optional absolute `.json` path in an existing directory. A leading `~` and `${VAR}` are expanded. When stdin `rate_limits` exists, Context Lens writes a private snapshot for other local tools. Relative paths, non-json files, and missing parent directories are ignored |
| `display.externalUsageFreshnessMs` | number | `300000` | Maximum allowed age for the external usage snapshot before it is ignored |
| `display.showTokenBreakdown` | boolean | true | Show token details at high context (85%+) |
| `display.contextDetailMode` | `always` \| `warning` \| `critical` \| `never` | `critical` | When to show the token breakdown: always, at the warning threshold, only at the critical threshold, or never |
| `display.contextWarningThreshold` | 0-100 | 70 | Context percentage at which the context bar turns the warning colour |
| `display.contextCriticalThreshold` | 0-100 | 85 | Context percentage at which the context bar turns the critical colour and shows the token breakdown |
| `display.showTools` | boolean | false | Show tools activity line |
| `display.showSkills` | boolean | false | Show active Skills detected from `Skill` tool invocations |
| `display.showMcp` | boolean | false | Show active MCP servers detected from `mcp__server__tool` invocations |
| `display.toolNameMaxLength` | number | `0` | Maximum displayed tool-name length. `0` keeps full names; MCP names may shorten to their final segment when truncating |
| `display.toolsMaxVisible` | number | `4` | Maximum completed tools shown on the tools line. `0` means unlimited |
| `display.skillsMaxVisible` | number | `4` | Maximum skill names shown on the skills line before `+N more`. `0` means unlimited |
| `display.showAgents` | boolean | false | Show agents activity line |
| `display.showTodos` | boolean | false | Show todos progress line |
| `display.showSessionName` | boolean | false | Show the session name: the `/rename` name, or the title Claude Code generated |
| `display.showSessionTokens` | boolean | false | Show the session's cumulative token totals, e.g. `Tokens 262k (in: 6k, out: 2k, cache: 254k)` |
| `display.defaultHideSessionTokens` | boolean | true | Hide the session token summary even when `showSessionTokens` is true; set to `false` to show it |
| `display.showLens` | boolean | false | Show the complete Context Lens breakdown, main/agent totals and custom costs when showTerminal is true. Live capture is independent of this setting. |
| `display.showAuth` | boolean | false | Show the auth method (subscription plan) of the current login as its own segment at the end of the first line, e.g. `Claude Max 20x`. Derived from the `oauthAccount` block in `~/.claude.json` (or `$CLAUDE_CONFIG_DIR/.claude.json` when the config directory is overridden); shows `API Key` when there is no OAuth login but `ANTHROPIC_API_KEY` is set |
| `display.showAuthUser` | boolean | false | Show the logged-in account (email local part, falling back to profile display name) next to the auth method |
| `display.authUserLength` | number | `8` | Maximum characters of the account name to display before truncating with `…`. `0` shows the full name |
| `display.showAdvisor` | boolean | false | Inline the model configured via Claude Code's `/advisor` on the project line, e.g. `Advisor: Opus 4.7`. Read from the `advisorModel` field that Claude Code stamps on each assistant transcript record; sanitised and capped at 64 chars before rendering |
| `display.advisorOverride` | string | `""` | Optional manual override for the displayed advisor label. When non-empty, replaces transcript-driven detection. Also sanitised and capped at 64 chars |
| `display.showSessionStartDate` | boolean | false | Show the transcript session start timestamp |
| `display.showLastResponseAt` | boolean | false | Show how long ago the last assistant response was written |
| `display.showCompactions` | boolean | false | Show how many context compactions (manual `/compact` or auto) have occurred this session, counted from transcript `compact_boundary` entries, e.g. `Compactions: 2`. Hidden until the first compaction |
| `display.showCompactionsOnlyWhenPresent` | boolean | true | Hide the compactions indicator when the compaction count is zero |
| `display.showGitFilesInCompact` | boolean | false | Show the recently-changed git files line in the compact layout (always shown in expanded) |
| `display.showEffortLevel` | boolean | false | Show the current reasoning effort in the model badge. Ultracode renders as `ultracode(xhigh)`, detected from the session transcript so it tracks `/effort` changes made at runtime |
| `display.effortFormat` | `full` \| `symbol` \| `text` | `full` | How the effort renders when `display.showEffortLevel` is on: symbol and level text (`◑ high`), symbol only (`◑`), or level text only (`high`). Ultracode keeps the full `◕ ultracode(xhigh)` form under `symbol` so the marker is not lost, and levels without a known symbol fall back to the level text |
| `display.showClaudeCodeVersion` | boolean | false | Show the running Claude Code version, e.g. `CC v2.1.81` |
| `display.showMemoryUsage` | boolean | false | Show an approximate system RAM usage line in expanded layout |
| `display.showPromptCache` | boolean | false | Show when the main conversation's prompt cache expires |
| `display.showCacheHitRate` | boolean | false | Show the session's prompt-cache hit rate as `Cache hit X%` |
| `display.customLine` | string | `""` | Custom text shown on the first line (80 characters max) |
| `display.customLinePosition` | `first` \| `last` | `last` | Put the custom text at the start or the end of the first line |
| `colors.context` | color value | `green` | Base color for the context bar and context percentage |
| `colors.usage` | color value | `brightBlue` | Base color for usage bars and percentages below warning thresholds |
| `colors.warning` | color value | `yellow` | Warning color for context thresholds and usage warning text |
| `colors.usageWarning` | color value | `brightMagenta` | Warning color for usage bars and percentages near their threshold |
| `colors.critical` | color value | `red` | Critical color for limit-reached states and critical thresholds |
| `colors.model` | color value | `cyan` | Color for the model badge such as `[Opus]` |
| `colors.project` | color value | `yellow` | Color for the project path |
| `colors.git` | color value | `magenta` | Color for git wrapper text such as `git:(` and `)` |
| `colors.gitBranch` | color value | `cyan` | Color for the git branch and branch status text |
| `colors.label` | color value | `dim` | Color for labels and secondary metadata such as `Context`, `Usage`, counts, and progress text |
| `colors.custom` | color value | `208` | Color for the optional custom line |
| `colors.barFilled` | string | `█` | Character used for the filled portion of progress bars |
| `colors.barEmpty` | string | `░` | Character used for the empty portion of progress bars |

Colors accept a name (`dim`, `red`, `green`, `yellow`, `magenta`, `cyan`, `brightBlue`, `brightMagenta`), a 256-color number (`0-255`), or hex (`#rrggbb`). `colors.barFilled` and `colors.barEmpty` take a single visible character; wide characters such as emoji may affect bar alignment in some terminals.

</details>

## Build from source

Build tools require Node.js 24. macOS also requires Xcode Command Line Tools.

```sh
git clone --branch main https://github.com/Chin-Jing1998/context-lens.git
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
