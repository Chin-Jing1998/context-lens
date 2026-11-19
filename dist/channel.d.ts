import type { StdinData } from './types.ts';
/**
 * Every file logic may read, named by logicPaths in collector.mjs, which grants exactly these.
 * Logic works out no path of its own. A null project means stdin had no usable cwd.
 */
export interface Paths {
    /** The one directory logic may write. */
    data: string;
    config: string;
    override: string;
    heartbeat: string;
    claudeJson: string;
    user: {
        claudeMd: string;
        rules: string;
        settings: string;
    };
    /** dotClaudeMd, rules and settings are null when the project's .claude is the user's config dir. */
    project: {
        claudeMd: string;
        localMd: string;
        mcpJson: string;
        dotClaudeMd: string | null;
        dotLocalMd: string;
        rules: string | null;
        settings: string | null;
        localSettings: string;
    } | null;
    transcript: string | null;
    subagents: string | null;
}
export interface Input {
    stdin: StdinData | null;
    /** The render's one clock reading, taken by hud.mjs so a replayed input renders the same. */
    now: number;
    contextBudget?: number | null;
    paths: Paths;
    /** A `hud <name> …` subcommand instead of a render, with the facts hud.mjs gathered for it. */
    command?: {
        name: string;
        args: string[];
        facts: Facts;
    };
}
/** What hud.mjs knows that logic can't look up from inside the cage. See commandFacts in collector.mjs. */
export interface Facts {
    runtime: {
        name: string;
        version: string;
        path: string;
        supported: boolean;
    };
    runtimes: Array<{
        manager: string;
        version: string;
        path: string;
        supported: boolean | null;
    }>;
    plugin: {
        root: string;
        version: string | null;
    };
    configPath: string;
    undoPath: string;
    cwd: string;
    /** The last render Claude Code ran, written by hud.mjs: when, on what, how it went, and its input. */
    heartbeat: {
        at: number;
        runtime: string;
        path: string;
        outcome: string;
        columns: number | null;
        stdin: StdinData | null;
    } | null;
}
export type Probe = 'git.status' | 'git.numstat' | 'git.branch' | 'git.describe' | 'jj' | 'memory' | 'extra' | 'usage.read' | 'usage.target';
export type Answers = Partial<Record<Probe, unknown>>;
export type Ask = (probes: Probe[]) => Promise<Answers>;
export interface Output {
    lines: string[];
    snapshot?: unknown;
    /** From `hud set`: the whole new config.json, which collector.mjs writes. */
    config?: Record<string, unknown>;
    /** A subcommand that refused or failed; hud.mjs exits 1. */
    failed?: boolean;
}
export declare function open(): Promise<Input>;
export declare const ask: Ask;
export declare function finish(output: Output): void;
//# sourceMappingURL=channel.d.ts.map