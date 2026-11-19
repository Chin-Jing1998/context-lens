import type { ParsedSession } from './reader.js';
import type { SessionFile } from './sessions.js';
import type { SessionInfo } from './types.js';
export declare const agyId: RegExp;
export type AgyRoots = Partial<Record<'desktop' | 'cli', string>>;
export declare const agyRoots: () => Required<AgyRoots>;
export declare function agyHistory(root: string, id: string): string | undefined;
export declare function agyStamp(file: string): string;
export declare function discoverAgySessions(roots?: AgyRoots): SessionFile[];
export declare function readAgySession(file: SessionFile): ParsedSession;
export declare function readAgyTranscript(file: SessionFile): Promise<ParsedSession>;
interface AgyLive {
    id: string;
    at: string;
    model: string;
    size: number | null;
    percent: number | null;
    usage?: string;
}
export declare function captureAgyStatusline(): Promise<void>;
export declare function readAgyLive(info: SessionInfo, lastContextAt?: string): AgyLive | undefined;
export {};
//# sourceMappingURL=agy.d.ts.map