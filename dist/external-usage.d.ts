import type { HudConfig } from './config.ts';
import type { UsageData } from './types.ts';
export declare const EXTERNAL_USAGE_WRITE_THROTTLE_MS = 30000;
type WrittenWindow = {
    used_percentage: number | null;
    resets_at: string | null;
};
export type WrittenSnapshot = {
    updated_at: string;
    five_hour: WrittenWindow;
    seven_day: WrittenWindow;
};
/** The `usage.target` probe's answer: the file now at the write path, or null when that path can't be written. */
export type UsageTarget = {
    text: string | null;
    mtimeMs: number | null;
} | null | undefined;
export declare function externalUsageSnapshot(target: UsageTarget, usage: UsageData | null, now?: number): WrittenSnapshot | null;
export declare function getUsageFromExternalSnapshot(text: unknown, config: HudConfig, now?: number): UsageData | null;
export declare function resolveUsage(config: HudConfig, stdinUsage: UsageData | null, snapshotText: unknown, now?: number): UsageData | null;
export {};
//# sourceMappingURL=external-usage.d.ts.map