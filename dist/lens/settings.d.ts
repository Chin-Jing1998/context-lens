import type { Budget, LensConfig } from './types.js';
export declare const lensHome: () => string;
export declare const configPath: () => string;
export declare const record: (x: unknown) => Record<string, any>;
export declare function readDocument(file: string, toml?: boolean): Record<string, any>;
export declare function atomicJson(file: string, value: unknown): void;
export declare function validatePrices(value: unknown): LensConfig;
export declare function readPrices(): LensConfig;
export declare function tokenSetting(value: unknown, shorthand?: boolean): number | 'auto' | null;
export interface SettingsResult {
    budget: Budget;
    capacity: number | null;
    warnings: string[];
}
export interface LaunchSettings {
    autoCompact?: number | 'auto';
    disabled?: boolean;
    profile?: string;
    overrides?: Record<string, unknown>;
}
export declare function launchSettings(client: 'claude' | 'codex', argv: string[]): LaunchSettings;
export declare function resolveClaudeSettings(args: {
    cwd: string;
    model: string;
    capacity: number | null;
    env?: NodeJS.ProcessEnv;
    launch?: LaunchSettings;
    files?: string[];
    globalFile?: string;
}): SettingsResult;
export declare function resolveCodexSettings(args: {
    cwd: string;
    capacity: number | null;
    launch?: LaunchSettings;
    home?: string;
    runtime?: Record<string, unknown>;
}): SettingsResult;
//# sourceMappingURL=settings.d.ts.map