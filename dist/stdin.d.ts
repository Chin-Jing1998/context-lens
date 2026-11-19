import type { StdinData, UsageData, TranscriptData } from './types.ts';
import type { ModelFormatMode } from './config.ts';
export declare function getTotalTokens(stdin: StdinData): number;
export interface ContextUsage {
    percent: number;
    tokens: number;
    size: number;
}
export declare function getContextUsage(stdin: StdinData, autoCompactWindow?: number | null, transcriptTokens?: number): ContextUsage;
export declare function isContextUnreported(stdin: StdinData): boolean;
export declare function getModelName(stdin: StdinData): string;
export declare function resolveModelName(stdin: StdinData, transcript: TranscriptData | undefined, modelSource?: 'auto' | 'stdin' | 'transcript'): string;
export declare function isBedrockModelId(modelId?: string): boolean;
export declare function isVertexModelId(modelId?: string): boolean;
export declare function getProviderLabel(stdin: StdinData, env?: NodeJS.ProcessEnv): string | null;
export declare function getUsageFromStdin(stdin: StdinData): UsageData | null;
export declare function stdinText(value: unknown, maxLength?: number): string | undefined;
export declare function stripContextSuffix(name: string): string;
export declare function formatModelName(name: string, format?: ModelFormatMode, override?: string): string;
//# sourceMappingURL=stdin.d.ts.map