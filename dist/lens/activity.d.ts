import type { ActivityCall, SessionActivity, SessionInfo } from './types.js';
export interface ActivityLog {
    calls: ActivityCall[];
    complete: boolean;
}
/** Count execution records, never JavaScript source text or installed tool inventories. */
export declare class ActivityReader {
    private info;
    private calls;
    private nativeIds;
    private processes;
    private continuations;
    private asynchronous;
    private reads;
    private native;
    private wrappers;
    constructor(info: SessionInfo);
    private key;
    private add;
    private finishReads;
    private result;
    private tool;
    accept(entry: Record<string, any>, ownTurn: boolean): void;
    finish(complete: boolean): ActivityLog;
}
export declare function summarizeActivity(main: ActivityLog, agents?: ActivityLog[]): SessionActivity;
//# sourceMappingURL=activity.d.ts.map