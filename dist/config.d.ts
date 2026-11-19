import type { Paths } from './channel.ts';
import type { Language } from './i18n/types.ts';
declare const LINE_LAYOUTS: readonly ['compact', 'expanded'];
declare const PATH_LEVELS: readonly [1, 2, 3, 'full'];
declare const CONTEXT_VALUE_MODES: readonly ['percent', 'tokens', 'remaining', 'both'];
declare const USAGE_VALUE_MODES: readonly ['percent', 'remaining'];
declare const GIT_BRANCH_OVERFLOW_MODES: readonly ['truncate', 'wrap'];
declare const MODEL_FORMATS: readonly ['full', 'compact', 'short'];
declare const MODEL_SOURCES: readonly ['auto', 'stdin', 'transcript'];
declare const EFFORT_FORMATS: readonly ['full', 'symbol', 'text'];
declare const TIME_FORMATS: readonly ['relative', 'absolute', 'both', 'elapsed', 'elapsedAndAbsolute'];
declare const HOUR_CYCLES: readonly ['auto', 'h11', 'h12', 'h23', 'h24'];
declare const CUSTOM_LINE_POSITIONS: readonly ['first', 'last'];
declare const ADDED_DIRS_LAYOUTS: readonly ['inline', 'line'];
declare const WEEKLY_COST_PERIODS: readonly ['quota', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
declare const COLOR_NAMES: readonly ['dim', 'red', 'green', 'yellow', 'magenta', 'cyan', 'brightBlue', 'brightMagenta'];
declare const CONTEXT_DETAIL_MODES: readonly ['always', 'warning', 'critical', 'never'];
declare const USAGE_DETAIL_MODES: readonly ['always', 'threshold', 'never'];
declare const COMPACT_CONTEXT_FORMATS: readonly ['full', 'minimal'];
declare const ELEMENTS: readonly ['project', 'addedDirs', 'context', 'usage', 'promptCache', 'cacheHitRate', 'memory', 'environment', 'tools', 'skills', 'mcp', 'agents', 'todos', 'sessionTime', 'sessionTokens', 'cost'];
declare const FIRST_LINE_SEGMENTS: readonly ['model', 'project', 'advisor', 'sessionName', 'version', 'extra', 'duration', 'cost', 'speed', 'auth'];
export type LineLayoutType = typeof LINE_LAYOUTS[number];
export type PathLevels = typeof PATH_LEVELS[number];
export type ContextValueMode = typeof CONTEXT_VALUE_MODES[number];
export type UsageValueMode = typeof USAGE_VALUE_MODES[number];
export type GitBranchOverflowMode = typeof GIT_BRANCH_OVERFLOW_MODES[number];
export type ModelFormatMode = typeof MODEL_FORMATS[number];
export type EffortFormatMode = typeof EFFORT_FORMATS[number];
export type TimeFormatMode = typeof TIME_FORMATS[number];
export type HourCycleMode = typeof HOUR_CYCLES[number];
export type CustomLinePosition = typeof CUSTOM_LINE_POSITIONS[number];
export type AddedDirsLayout = typeof ADDED_DIRS_LAYOUTS[number];
export type WeeklyCostPeriod = typeof WEEKLY_COST_PERIODS[number];
export type HudColorName = typeof COLOR_NAMES[number];
export type HudElement = typeof ELEMENTS[number];
export type FirstLineSegment = typeof FIRST_LINE_SEGMENTS[number];
export type ContextDetailMode = typeof CONTEXT_DETAIL_MODES[number];
export type UsageDetailMode = typeof USAGE_DETAIL_MODES[number];
export type CompactContextFormat = typeof COMPACT_CONTEXT_FORMATS[number];
/** A named preset, a 256-color index (0-255), or a #rrggbb hex string. */
export type HudColorValue = HudColorName | number | string;
export interface HudColorOverrides {
    context: HudColorValue;
    usage: HudColorValue;
    warning: HudColorValue;
    usageWarning: HudColorValue;
    critical: HudColorValue;
    model: HudColorValue;
    project: HudColorValue;
    git: HudColorValue;
    gitBranch: HudColorValue;
    label: HudColorValue;
    custom: HudColorValue;
    barFilled: string;
    barEmpty: string;
}
export declare const DEFAULT_ELEMENT_ORDER: HudElement[];
export declare const DEFAULT_MERGE_GROUPS: HudElement[][];
export declare const DEFAULT_PROJECT_LINE_ORDER: FirstLineSegment[];
export interface HudConfig {
    language: Language;
    lineLayout: LineLayoutType;
    showSeparators: boolean;
    pathLevels: PathLevels;
    maxWidth: number | null;
    forceMaxWidth: boolean;
    elementOrder: HudElement[];
    projectLineOrder: FirstLineSegment[];
    gitStatus: {
        enabled: boolean;
        showDirty: boolean;
        showAheadBehind: boolean;
        showFileStats: boolean;
        showWorktree: boolean;
        branchOverflow: GitBranchOverflowMode;
        pushWarningThreshold: number;
        pushCriticalThreshold: number;
    };
    jjStatus: {
        enabled: boolean;
        showDirty: boolean;
        showConflicts: boolean;
    };
    display: {
        showTerminal: boolean;
        showModel: boolean;
        showProject: boolean;
        showLaunchDir: boolean;
        showAddedDirs: boolean;
        addedDirsLayout: AddedDirsLayout;
        showContextBar: boolean;
        contextValue: ContextValueMode;
        showConfigCounts: boolean;
        showCost: boolean;
        showRoutedCost: boolean;
        showDailyCost: boolean;
        showWeeklyCost: boolean;
        weeklyCostPeriod: WeeklyCostPeriod;
        showDuration: boolean;
        showSpeed: boolean;
        showTokenBreakdown: boolean;
        showUsage: boolean;
        usageValue: UsageValueMode;
        usageBarEnabled: boolean;
        showResetLabel: boolean;
        usageCompact: boolean;
        showModelScopedUsage: boolean;
        usagePace: boolean;
        showTools: boolean;
        showSkills: boolean;
        showMcp: boolean;
        toolNameMaxLength: number;
        toolsMaxVisible: number;
        skillsMaxVisible: number;
        showAgents: boolean;
        showTodos: boolean;
        showSessionName: boolean;
        showAuth: boolean;
        showAuthUser: boolean;
        authUserFullEmail: boolean;
        authUserLength: number;
        showClaudeCodeVersion: boolean;
        showEffortLevel: boolean;
        effortFormat: EffortFormatMode;
        showAgentEffort: boolean;
        showMemoryUsage: boolean;
        showPromptCache: boolean;
        showCacheHitRate: boolean;
        showSessionTokens: boolean;
        showLens: boolean;
        showOutputStyle: boolean;
        showSessionStartDate: boolean;
        showLastResponseAt: boolean;
        showCompactions: boolean;
        mergeGroups: HudElement[][];
        rightAlign: HudElement[];
        contextWarningThreshold: number;
        contextCriticalThreshold: number;
        usageThreshold: number;
        sevenDayThreshold: number;
        environmentThreshold: number;
        externalUsagePath: string;
        externalUsageWritePath: string;
        externalUsageFreshnessMs: number;
        modelFormat: ModelFormatMode;
        modelOverride: string;
        modelSource: typeof MODEL_SOURCES[number];
        showProvider: boolean;
        providerName: string;
        customLine: string;
        customLinePosition: CustomLinePosition;
        timeFormat: TimeFormatMode;
        hourCycle: HourCycleMode;
        showClockSeconds: boolean;
        showAdvisor: boolean;
        advisorOverride: string;
        autoCompactWindow: number | null;
        contextDetailMode: ContextDetailMode;
        usageDetailMode: UsageDetailMode;
        compactContextFormat: CompactContextFormat;
        showGitFilesInCompact: boolean;
        defaultHideSessionTokens: boolean;
        showCompactionsOnlyWhenPresent: boolean;
    };
    colors: HudColorOverrides;
}
export declare const DEFAULT_CONFIG: HudConfig;
export interface ConfigKey {
    key: string;
    default: unknown;
    accepts: string;
    freeText: boolean;
}
/** Every config key with its default and what it accepts, in DEFAULT_CONFIG order. */
export declare function configKeys(defaults?: Record<string, unknown>, prefix?: string): ConfigKey[];
/** The key's entry, or undefined for a key config.json doesn't have. */
export declare const configKey: (key: string) => ConfigKey | undefined;
/** Why `value` is not valid for `key`, or null when it is. A value a rule would change counts as invalid. */
export declare function checkValue(key: string, value: unknown): string | null;
/** Each set key whose value would be ignored or changed. Unknown keys are left alone. */
export declare function configProblems(raw: Record<string, unknown>, prefix?: string): string[];
export declare function mergeConfig(userConfig: Partial<HudConfig>): HudConfig;
export declare function mergeOverrides(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown>;
export interface LoadedConfig {
    config: HudConfig;
    /** config.json alone, as written: what `hud set` edits. */
    base: Record<string, unknown>;
    /** Why config.json exists but couldn't be read, or null. `hud set` must not overwrite it then. */
    baseUnreadable: string | null;
    /** context-lens.json, whose keys win over config.json. */
    override: Record<string, unknown>;
    /** Values that are ignored, each naming its file and key. Empty when the config is fine. */
    problems: string[];
}
export declare function loadConfigFiles(paths: Pick<Paths, 'config' | 'override'>): LoadedConfig;
export declare function loadConfig(paths: Pick<Paths, 'config' | 'override'>): Promise<HudConfig>;
export {};
//# sourceMappingURL=config.d.ts.map