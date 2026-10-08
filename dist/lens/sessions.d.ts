import { type LaunchSettings } from './settings.js';
import type { SessionInfo, RequestUsage } from './types.js';
import type { StdinData } from '../types.js';
export interface SessionFile extends SessionInfo {
    file: string;
    size: number;
    mtimeMs: number;
    lastUserAt?: number;
}
export declare const validId: (id: unknown) => id is string;
export declare const sessionKey: (s: {
    client: string;
    id: string;
}) => string;
export declare const dataPath: (kind: string, s: Pick<SessionInfo, 'client' | 'id'>) => string;
/** Read only explicit user activity; file modification times also include background output. */
export declare function lastUserActivity(entries: any[], client: 'claude' | 'codex'): number | undefined;
export declare function discoverSessions(roots?: {
    claude?: string;
    codex?: string;
}): SessionFile[];
export interface LiveClaude {
    stdin: StdinData;
    at: string;
    launch?: LaunchSettings;
    hudWindow?: number;
    environment: Record<string, string>;
}
export declare function captureClaude(stdin: StdinData, launch?: LaunchSettings, hudWindow?: number): void;
export declare function readLiveClaude(session: SessionInfo): LiveClaude | null;
/** ps exposes launch flags on macOS; values are never logged or persisted as command text. */
export declare function claudeLaunchSettings(): LaunchSettings | undefined;
export declare function checkpoint(session: SessionInfo, rows: RequestUsage[], cumulative?: RequestUsage): {
    requests: RequestUsage[];
    cumulative?: RequestUsage;
};
//# sourceMappingURL=sessions.d.ts.map