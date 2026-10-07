import type { ClaudeDetails, SessionInsights } from './types.js';
/** Reads observed execution metadata. Prompt bodies, commands and tool output are never returned. */
export declare class ClaudeDetailsReader {
    private complete;
    private compactions;
    private hooks;
    private stops;
    private files;
    private tasks;
    private agents;
    private taskInputs;
    private results;
    private metadata;
    private eventId;
    accept(entry: Record<string, any>): void;
    private tool;
    private result;
    finish(): ClaudeDetails;
}
export declare function summarizeDetails(details: ClaudeDetails): SessionInsights;
//# sourceMappingURL=claude-details.d.ts.map