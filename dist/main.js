import { ask, finish, open } from "./channel.js";
import { getUsageFromStdin, isContextUnreported } from "./stdin.js";
import { addSubagentEfforts, parseTranscript } from "./transcript.js";
import { renderLines } from "./render/index.js";
import { shownAgents } from "./render/activity.js";
import { countConfigs } from "./config-reader.js";
import { getGitStatus } from "./git.js";
import { getJjStatus } from "./jj.js";
import { loadConfigFiles } from "./config.js";
import { extraCmdLabel } from "./extra-cmd.js";
import { getMemoryUsage, readMemory } from "./memory.js";
import { readAuthInfo } from "./auth.js";
import { getCostTotals } from "./daily-cost.js";
import { getOutputSpeed } from "./speed.js";
import { externalUsageSnapshot, resolveUsage } from "./external-usage.js";
import { getTerminalWidth } from "./utils/terminal.js";
import { truncateToWidth, visibleWidth } from "./render/ansi.js";
import { setLanguage, t } from "./i18n/index.js";
// The caged half of a render. hud.mjs starts this under node --permission with fence.mjs loaded,
// hands it the stdin payload, runs the probes it asks for, and prints the lines it returns. For a
// `hud <command>` it gets the command instead (see commands.ts).
const EMPTY_TRANSCRIPT = { tools: [], skills: [], mcpServers: [], mcpErrors: [], agents: [], todos: [] };
const NO_COUNTS = { claudeMdCount: 0, rulesCount: 0, mcpCount: 0, hooksCount: 0 };
function needsTranscript(config, stdin) {
    const d = config.display;
    return d.showTools || d.showSkills || d.showMcp || d.showAgents || d.showTodos
        || d.showConfigCounts || d.showSessionTokens || d.showCompactions || d.showAdvisor
        || d.showSessionStartDate || d.showLastResponseAt || d.showEffortLevel
        || d.modelSource !== "stdin"
        || isContextUnreported(stdin);
}
// jj wins in a repo that has one and opts in; git is the fallback when the jj probe fails.
async function resolveVcsStatus(config, ask, cwd, repo) {
    if (!cwd)
        return null;
    if (config.jjStatus.enabled) {
        const jjStatus = await getJjStatus(ask);
        if (jjStatus)
            return jjStatus;
    }
    return config.gitStatus.enabled
        ? getGitStatus(ask, { lineDiffs: config.gitStatus.showFileStats, repo })
        : null;
}
export async function renderStdin(stdin, config, { ask, files, paths, dataDir, now, columns, contextBudget }) {
    // Labels follow the config being rendered, which for a preview isn't the saved one.
    setLanguage(config.language);
    const display = config.display;
    const stdinUsage = getUsageFromStdin(stdin);
    const facts = ["extra"];
    if (display.showMemoryUsage && config.lineLayout === "expanded")
        facts.push("memory");
    if (display.showUsage && display.externalUsagePath)
        facts.push("usage.read");
    if (display.externalUsageWritePath && stdinUsage)
        facts.push("usage.target");
    const readTranscript = async () => {
        const data = await parseTranscript(paths.transcript ?? "", dataDir);
        // Only the agents the line will show, since each lookup opens a file.
        if (display.showAgents && display.showAgentEffort && paths.subagents)
            await addSubagentEfforts(paths.subagents, shownAgents(data.agents, now));
        return data;
    };
    const [answers, transcript, gitStatus] = await Promise.all([
        ask(facts),
        files && needsTranscript(config, stdin) ? readTranscript() : EMPTY_TRANSCRIPT,
        resolveVcsStatus(config, ask, stdin.cwd, stdin.workspace?.repo),
    ]);
    const usageData = display.showUsage ? resolveUsage(config, stdinUsage, answers["usage.read"], now) : null;
    const lines = renderLines({
        stdin,
        contextBudget,
        transcript,
        ...(files && display.showConfigCounts ? countConfigs(paths) : NO_COUNTS),
        costTotals: display.showDailyCost || display.showWeeklyCost
            ? getCostTotals(stdin, { allowRoutedCost: display.showRoutedCost, sevenDayResetAt: usageData?.sevenDayResetAt ?? null,
                weeklyCostPeriod: display.weeklyCostPeriod }, { dataDir: () => dataDir, now: () => now })
            : null,
        outputSpeed: display.showSpeed ? getOutputSpeed(stdin, dataDir) : null,
        gitStatus,
        usageData,
        memoryUsage: "memory" in answers ? getMemoryUsage(readMemory(answers.memory)) : null,
        config,
        extraLabel: extraCmdLabel(answers.extra),
        authInfo: files && (display.showAuth || display.showAuthUser) ? readAuthInfo(paths.claudeJson) : null,
    }, columns, now);
    const snapshot = externalUsageSnapshot(answers["usage.target"], stdinUsage, now);
    return snapshot ? { lines, snapshot } : { lines };
}
// A config problem is one line ending in /hud, never a silent fallback. Like every line it fits the
// terminal; when it can't, the problem is cut, never the way to fix it.
const FIX = ". Type /context-lens:hud to fix it.";
function problemLine(problems, columns) {
    if (problems.length === 0)
        return [];
    const more = problems.length > 1 ? ` (and ${problems.length - 1} more)` : "";
    const line = `context-lens: ${problems[0]}${more}`;
    if (!columns || visibleWidth(line + FIX) <= columns)
        return [line + FIX];
    return [truncateToWidth(`${truncateToWidth(line, Math.max(1, columns - FIX.length))}${FIX}`, columns)];
}
export async function main() {
    const input = await open();
    try {
        const loaded = loadConfigFiles(input.paths);
        setLanguage(loaded.config.language);
        if (input.command) {
            // Loaded only for a subcommand, so a render doesn't pay for it.
            const { runCommand } = await import("./commands.js");
            finish(await runCommand(input, loaded, renderStdin, ask));
            return;
        }
        const { stdin, paths, now } = input;
        if (!stdin) {
            // Setup runs the command without input to check that it starts.
            finish({ lines: [t("init.initializing"), ...(process.platform === "darwin" ? [t("init.macosNote")] : [])] });
            return;
        }
        const columns = getTerminalWidth();
        const output = await renderStdin(stdin, loaded.config, { ask, files: true, paths, dataDir: paths.data, now, columns, contextBudget: input.contextBudget });
        finish({ ...output, lines: [...output.lines, ...problemLine(loaded.problems, columns)] });
    }
    catch (error) {
        finish({ lines: [`[context-lens] Error: ${error instanceof Error ? error.message : "Unknown error"}. Type /context-lens:hud to fix it.`], failed: true });
    }
}
await main();
//# sourceMappingURL=main.js.map