import { type Ask, type Output, type Paths } from "./channel.ts";
import { type HudConfig } from "./config.ts";
import type { StdinData } from "./types.ts";
/** Where a render's inputs come from. `files: false` renders from stdin alone, as a report's case does. */
export interface Sources {
    ask: Ask;
    files: boolean;
    /** What logic may read, from collector.mjs. */
    paths: Paths;
    /** Where this render keeps state: paths.data, or a scratch dir for a preview. */
    dataDir: string;
    now: number;
    columns: number | null;
    contextBudget?: number | null;
}
export declare function renderStdin(stdin: StdinData, config: HudConfig, { ask, files, paths, dataDir, now, columns, contextBudget }: Sources): Promise<Output>;
export declare function main(): Promise<void>;
//# sourceMappingURL=main.d.ts.map