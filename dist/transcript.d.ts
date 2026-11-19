import type { AgentEntry, TranscriptData } from './types.ts';
export declare function parseTranscript(transcriptPath: string, dataDir: string): Promise<TranscriptData>;
/** Sets each agent's effort in place; agents without a known id or first reply stay without one. */
export declare function addSubagentEfforts(subagentsDir: string, agents: AgentEntry[]): Promise<void>;
//# sourceMappingURL=transcript.d.ts.map