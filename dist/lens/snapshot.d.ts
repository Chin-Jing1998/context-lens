import { type SessionFile, type LiveClaude } from './sessions.js';
import { type LaunchSettings } from './settings.js';
import { type DetailQuery } from './session-details.js';
import { type AgyRoots } from './agy.js';
import type { HudSnapshot } from './types.js';
export declare class SessionCollector {
    private roots?;
    private files;
    private scanned;
    private parsed;
    constructor(roots?: {
        claude?: string;
        codex?: string;
        agy?: AgyRoots;
    } | undefined);
    list(refresh?: boolean): SessionFile[];
    private read;
    private saveParsed;
    get(key: string, options?: {
        view?: 'budget' | 'model';
        launch?: LaunchSettings;
        git?: boolean;
    }): Promise<HudSnapshot>;
    details(key: string, query?: DetailQuery): Promise<{
        session: string;
        section: import("./session-details.js").DetailSection;
        scope: string;
        history: string;
        supported: boolean;
        complete: boolean;
        total: number;
        page: number;
        pages: number;
        pageSize: number;
        items: (Record<string, any> & {
            id: string;
            sessionId: string;
            scope: 'main' | 'agent';
            at: string | null;
        })[];
        unavailable: string[];
        capturedAt: string;
    }>;
    snapshot(file: SessionFile, options?: {
        view?: 'budget' | 'model';
        launch?: LaunchSettings;
        live?: LiveClaude;
        git?: boolean;
    }): Promise<HudSnapshot>;
}
//# sourceMappingURL=snapshot.d.ts.map