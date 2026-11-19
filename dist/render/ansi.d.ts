/** Terminal cells taken by plain text (no escape sequences). */
export declare function textWidth(text: string): number;
export declare function visibleWidth(str: string): number;
export declare function stripAnsi(str: string): string;
export declare function truncateToWidth(str: string, width: number): string;
/** Wraps at the HUD's separators, truncating any part that still overflows. */
export declare function wrapToWidth(line: string, width: number): string[];
/** A dim rule `width` cells wide; ─ is ambiguous-width, so CJK terminals need half as many. */
export declare function separatorLine(width: number): string;
//# sourceMappingURL=ansi.d.ts.map