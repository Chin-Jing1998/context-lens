import * as os from "node:os";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getUsageFromStdin, isContextUnreported, readStdin } from "./stdin.js";
import { parseTranscript } from "./transcript.js";
import { render } from "./render/index.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { getJjStatus, isJjRepo } from "./jj.js";
import { loadConfig } from "./config.js";
import { parseExtraCmdArg, runExtraCmd } from "./extra-cmd.js";
import { getMemoryUsage } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { getCostTotals } from "./daily-cost.js";
import { getOutputSpeed } from "./speed.js";
import { resolveUsage, writeExternalUsageSnapshot } from "./external-usage.js";
import { setLanguage, t } from "./i18n/index.js";
import { resolveClaudeSettings } from "./lens/settings.js";
const EMPTY_TRANSCRIPT = { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] };
const NO_COUNTS = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 };
// CONTEXT_LENS_DISABLE=1 blanks the HUD for one session while keeping the statusLine setting.
export function isHudDisabled(env = process.env) {
    const value = env.CONTEXT_LENS_DISABLE?.trim().toLowerCase();
    return !!value && !["0", "false", "off", "no"].includes(value);
}
function needsTranscript(config, stdin) {
    const d = config.display;
    return d.showTools || d.showSkills || d.showMcp || d.showAgents || d.showTodos
        || d.showConfigCounts || d.showSessionTokens || d.showCompactions || d.showAdvisor
        || d.showSessionStartDate || d.showLastResponseAt || d.showEffortLevel
        || d.modelSource !== "stdin"
        || isContextUnreported(stdin);
}
// jj wins in a repo that has one and opts in; git is the fallback when the jj probe fails.
export async function resolveVcsStatus(config, cwd, repo) {
    if (!cwd)
        return null;
    if (config.jjStatus.enabled && isJjRepo(cwd)) {
        const jjStatus = await getJjStatus(cwd);
        if (jjStatus)
            return jjStatus;
    }
    return config.gitStatus.enabled
        ? getGitStatus(cwd, { lineDiffs: config.gitStatus.showFileStats, repo })
        : null;
}
export async function main() {
    if (isHudDisabled())
        return;
    let showTerminal = false;
    try {
        const config = await loadConfig();
        showTerminal = config.display.showTerminal;
        const stdin = await readStdin();
        setLanguage(config.language);
        if (!stdin) {
            // Setup runs the command without input to check that it starts.
            if (showTerminal) {
                console.log(t("init.initializing"));
                if (process.platform === "darwin")
                    console.log(t("init.macosNote"));
            }
            return;
        }
        const display = config.display;
        const { claudeLaunchSettings, captureClaude } = await import('./lens/sessions.js');
        const launch = claudeLaunchSettings();
        // The statusline is also a silent live-data bridge for the floating app.
        try {
            captureClaude(stdin, launch, display.autoCompactWindow ?? undefined);
        }
        catch { /* The panel reports missing live data. */ }
        if (!showTerminal)
            return;
        const now = Date.now();
        const extraCmd = parseExtraCmdArg();
        const [transcript, gitStatus, extraLabel, memoryUsage] = await Promise.all([
            needsTranscript(config, stdin) ? parseTranscript(stdin.transcript_path ?? "") : EMPTY_TRANSCRIPT,
            resolveVcsStatus(config, stdin.cwd, stdin.workspace?.repo),
            extraCmd ? runExtraCmd(extraCmd) : null,
            display.showMemoryUsage && config.lineLayout === "expanded" ? getMemoryUsage() : null,
        ]);
        const stdinUsage = getUsageFromStdin(stdin);
        if (display.externalUsageWritePath && stdinUsage) {
            writeExternalUsageSnapshot(config, stdinUsage, now);
        }
        const usageData = display.showUsage ? resolveUsage(config, stdinUsage, now) : null;
        const budget = resolveClaudeSettings({ cwd: stdin.workspace?.project_dir || stdin.cwd || process.cwd(),
            model: stdin.model?.id || '', capacity: stdin.context_window?.context_window_size ?? null, launch });
        render({
            contextBudget: budget.budget.accuracy === 'configured' ? budget.budget.tokens : null,
            stdin,
            transcript,
            ...(display.showConfigCounts ? countConfigs(stdin.cwd) : NO_COUNTS),
            costTotals: display.showDailyCost || display.showWeeklyCost
                ? getCostTotals(stdin, { allowRoutedCost: display.showRoutedCost, sevenDayResetAt: usageData?.sevenDayResetAt ?? null })
                : null,
            outputSpeed: display.showSpeed ? getOutputSpeed(stdin, os.homedir()) : null,
            gitStatus,
            usageData,
            memoryUsage,
            config,
            extraLabel,
            authInfo: display.showAuth || display.showAuthUser ? readAuthInfo() : null,
        });
        if (display.showLens && stdin.session_id && stdin.transcript_path) {
            try {
                const { SessionCollector } = await import('./lens/snapshot.js');
                const { renderLensLines } = await import('./lens/terminal.js');
                const { statSync } = await import('node:fs');
                const stat = statSync(stdin.transcript_path);
                const snapshot = await new SessionCollector().snapshot({ client: 'claude', id: stdin.session_id,
                    cwd: stdin.cwd || '', model: stdin.model?.id || '', updatedAt: stat.mtime.toISOString(),
                    file: stdin.transcript_path, size: stat.size, mtimeMs: stat.mtimeMs });
                for (const line of renderLensLines(snapshot, process.stdout.columns || 100))
                    console.log(line);
            }
            catch {
                console.log('[context-lens] Extended metrics unavailable; check transcript access and configuration.');
            }
        }
    }
    catch (error) {
        if (showTerminal)
            console.log("[context-lens] Error:", error instanceof Error ? error.message : "Unknown error");
    }
}
const isSamePath = (a, b) => {
    try {
        return realpathSync(a) === realpathSync(b);
    }
    catch {
        return a === b;
    }
};
if (process.argv[1] && isSamePath(process.argv[1], fileURLToPath(import.meta.url))) {
    void main();
}
//# sourceMappingURL=index.js.map