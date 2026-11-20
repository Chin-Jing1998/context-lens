import type { ParsedSession } from './reader.js';
import type { SessionFile } from './sessions.js';
import type { QuotaLimit, SessionInfo, SessionTelemetry } from './types.js';
export declare const agyId: RegExp;
export type AgyRoots = Partial<Record<'desktop' | 'cli', string>>;
export declare const agyRoots: () => Required<AgyRoots>;
export declare function agyHistory(root: string, id: string): string | undefined;
export declare function agySessionHistory(file: SessionFile): string | undefined;
export declare function agyStamp(file: string): string;
export declare function discoverAgySessions(roots?: AgyRoots): SessionFile[];
export declare function readAgySession(file: SessionFile, usageOnly?: boolean): ParsedSession;
export declare function readAgyTranscript(file: SessionFile, usageOnly?: boolean): Promise<ParsedSession>;
export declare function readAgyFile(file: SessionFile, history?: string, usageOnly?: boolean): Promise<ParsedSession>;
interface AgyLive {
    id: string;
    at: string;
    contextAt?: string;
    model: string;
    size: number | null;
    percent: number | null;
    usage?: string;
    quota?: QuotaLimit[];
    telemetry?: SessionTelemetry;
}
export declare function captureAgyStatusline(): Promise<void>;
export declare function readAgyLive(info: SessionInfo, lastContextAt?: string): AgyLive | undefined;
export {};
//# sourceMappingURL=agy.d.ts.map