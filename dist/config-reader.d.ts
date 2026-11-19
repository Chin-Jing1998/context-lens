import type { Paths } from './channel.ts';
export interface ConfigCounts {
    claudeMdCount: number;
    rulesCount: number;
    mcpCount: number;
    hooksCount: number;
}
/** Counts what the user and project configure. Each file comes from `paths`, so a missing one counts 0. */
export declare function countConfigs(paths: Pick<Paths, 'user' | 'project' | 'claudeJson'>): ConfigCounts;
//# sourceMappingURL=config-reader.d.ts.map