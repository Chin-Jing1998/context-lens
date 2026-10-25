import type { ActiveSessionInfo, VisibleSessionHint } from './active.js';
/** A bounded, read-only index. Metadata never supplies a path to a transcript. */
export declare class ClaudeDesktopSessions {
    private roots;
    private now;
    private at;
    private rows;
    private blocked;
    private complete;
    constructor(roots?: string[], now?: () => number);
    resolve(files: ActiveSessionInfo[], hint?: VisibleSessionHint): string | null | undefined;
    private refresh;
}
//# sourceMappingURL=claude-desktop.d.ts.map