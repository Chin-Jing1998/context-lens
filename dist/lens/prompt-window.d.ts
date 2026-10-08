import type { Category, Measurement, MessageSegment, SessionInfo } from './types.js';
type Estimate = (text: unknown, source: string, at: string) => Measurement | undefined;
/** Retains one prompt window, then tokenizes only its latest measured checkpoint. */
export declare class PromptWindow {
    private info;
    private estimate;
    private parts;
    private prefixes;
    private seen;
    private aliases;
    private checkpoint?;
    private revision;
    private diagnosticRevision;
    private ownStart;
    constructor(info: SessionInfo, estimate: Estimate);
    reset(preserved?: string[]): void;
    diagnostic(): void;
    invalidate(): void;
    mark(at: string, excludeOwner?: string): void;
    private put;
    private prefix;
    private codexItem;
    codex(entry: Record<string, any>, at: string, ownTurn: boolean): void;
    claude(entry: Record<string, any>, at: string): void;
    publish(categories: Partial<Record<Category, Measurement>>): MessageSegment[];
}
export {};
//# sourceMappingURL=prompt-window.d.ts.map