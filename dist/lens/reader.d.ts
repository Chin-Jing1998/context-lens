import { type ActivityLog } from './activity.js';
import { type TimingLog } from './timing.js';
import type { Category, ClaudeDetails, Measurement, MessageSegment, QuotaLimit, RequestUsage, SessionInfo, SessionTelemetry } from './types.js';
export interface ParsedSession {
    info: SessionInfo;
    requests: RequestUsage[];
    cumulative?: RequestUsage;
    used: number | null;
    capacity: number | null;
    at?: string;
    categories: Partial<Record<Category, Measurement>>;
    buffer?: Measurement & {
        placement: 'inside' | 'outside';
    };
    runtime: Record<string, unknown>;
    warnings: string[];
    complete: boolean;
    compacted: boolean;
    windowEstimated?: boolean;
    activity?: ActivityLog;
    timing?: TimingLog;
    details?: ClaudeDetails;
    messageBreakdown?: MessageSegment[];
    quota?: QuotaLimit[];
    telemetry?: SessionTelemetry;
}
export declare function parseEvents(info: SessionInfo, events: AsyncIterable<unknown> | Iterable<unknown>, options?: {
    usageOnly?: boolean;
}): Promise<ParsedSession>;
export declare function readSession(file: string, info: SessionInfo, options?: {
    usageOnly?: boolean;
}): Promise<ParsedSession>;
//# sourceMappingURL=reader.d.ts.map