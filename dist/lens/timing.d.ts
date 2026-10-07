import type { SessionInfo, SessionTiming } from './types.js';
interface Turn {
    id: string;
    start: number | null;
    end: number | null;
    duration: number | null;
    state: 'running' | 'completed' | 'interrupted';
}
export interface TimingLog {
    startedAt: number | null;
    reportedStart: boolean;
    lastActivityAt: number | null;
    turns: Turn[];
    complete: boolean;
}
/** Session clocks use log lifecycle records, never file mtime or HUD polling time. */
export declare class TimingReader {
    private info;
    private startedAt;
    private reportedStart;
    private last;
    private turns;
    private seen;
    private current;
    private complete;
    constructor(info: SessionInfo);
    private observe;
    accept(entry: Record<string, any>, ownTurn: boolean): void;
    finish(): TimingLog;
}
export declare function sessionTiming(log: TimingLog, now?: number): SessionTiming;
export {};
//# sourceMappingURL=timing.d.ts.map