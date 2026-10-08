import type { ParsedSession } from './reader.js';
import type { SessionFile } from './sessions.js';
import type { LensConfig } from './types.js';
export type DetailSection = 'requests' | 'activity' | 'compactions' | 'hooks' | 'hookStops' | 'files' | 'tasks' | 'agents';
export interface DetailQuery {
    section?: string;
    scope?: string;
    page?: number;
    pageSize?: number;
    status?: string;
    kind?: string;
    sort?: string;
}
export interface DetailSource {
    file: SessionFile;
    parsed: ParsedSession;
}
type DetailRow = Record<string, any> & {
    id: string;
    sessionId: string;
    scope: 'main' | 'agent';
    at: string | null;
};
export declare function validateDetailQuery(query: DetailQuery): {
    section: DetailSection;
    scope: string;
    page: number;
    pageSize: number;
    sort: string;
};
/** Read-only, paged projections over the same parsed logs and deduplicated accounting ledger. */
export declare function buildSessionDetails(key: string, sources: DetailSource[], prices: LensConfig, query?: DetailQuery, unavailable?: string[]): {
    session: string;
    section: DetailSection;
    scope: string;
    history: string;
    supported: boolean;
    complete: boolean;
    total: number;
    page: number;
    pages: number;
    pageSize: number;
    items: DetailRow[];
    unavailable: string[];
    capturedAt: string;
};
export {};
//# sourceMappingURL=session-details.d.ts.map