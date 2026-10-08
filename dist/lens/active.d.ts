interface Running {
    key: string;
    pid: number;
    evidence: string;
}
export interface ActiveResult {
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
}
export declare function isClaudeProcess(command: string): boolean;
export declare function windowsResumeCandidates(files: ActiveSessionInfo[], processes: WindowsProcess[]): Running[];
export declare function visibleSession(files: ActiveSessionInfo[], client?: string, hint?: VisibleSessionHint): string | null | undefined;
export declare function chooseActive(candidates: Running[], parents: Map<number, number>, targetPid?: number, activity?: Map<string, number>): ActiveResult;
/** Read live ownership evidence, never infer the active session from the newest historical log. */
export declare class ActiveSessions {
    private at;
    private running;
    private parents;
    private error;
    private lastInteraction;
    get(files: ActiveSessionInfo[], client?: string, targetPid?: number, hint?: VisibleSessionHint): ActiveResult;
    private scan;
}
export {};
//# sourceMappingURL=active.d.ts.map