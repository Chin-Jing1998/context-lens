import { type OrcaSession } from './orca-session.js';
interface Running {
    key: string;
    pid: number;
    evidence: string;
}
export interface ActiveResult {
    orcaSession?: string;
    selected: string | null;
    reason: string;
    candidates: Running[];
}
export interface VisibleSessionHint {
    id?: string;
    title?: string;
    cwd?: string;
    tty?: string;
}
export interface ActiveSessionInfo {
    id: string;
    client: string;
    surface?: 'desktop' | 'cli';
    parentId?: string;
    title?: string;
    cwd: string;
    lastUserAt?: number;
}
export interface WindowsProcess {
    ProcessId: number;
    ParentProcessId: number;
    Name: string;
    CommandLine?: string | null;
    ExecutablePath?: string;
}
export declare function isClaudeProcess(command: string): boolean;
export declare function windowsResumeCandidates(files: ActiveSessionInfo[], processes: WindowsProcess[]): Running[];
export declare function visibleSession(files: ActiveSessionInfo[], client?: string, hint?: VisibleSessionHint): string | null | undefined;
export declare function inProcessTree(pid: number, targetPid: number, parents: Map<number, number>): boolean;
export declare function chooseActive(candidates: Running[], parents: Map<number, number>, targetPid?: number, activity?: Map<string, number>): ActiveResult;
export declare function agyLockCandidates(output: string, directory: string, commands: Map<number, string>): Running[];
export declare function codexResumeCandidates(output: string, files: ActiveSessionInfo[], pids: ReadonlySet<number>): Running[];
export declare function orcaChatActive(host: OrcaSession | undefined, available: ReadonlySet<string>, client?: string): ActiveResult;
export declare function orcaAgentSessionResult(key: string | null, available: ReadonlySet<string>, client?: string): ActiveResult;
/** Read live ownership evidence, never infer the active session from the newest historical log. */
export declare class ActiveSessions {
    private paneAgent?;
    private windowsOrca;
    private windowsOwners;
    private ownersPending;
    terminalSession(id: string): OrcaSession | undefined;
    private at;
    private running;
    private parents;
    private commands;
    private error;
    private lastInteraction;
    private desktop;
    constructor(options?: {
        claudeDesktopRoots?: string[];
        now?: () => number;
    });
    get(files: ActiveSessionInfo[], client?: string, targetPid?: number, hint?: VisibleSessionHint): ActiveResult;
    private resumedCodex;
    private scanWindowsAgy;
    private scan;
}
export {};
//# sourceMappingURL=active.d.ts.map