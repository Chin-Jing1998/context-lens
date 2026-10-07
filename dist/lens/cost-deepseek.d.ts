import type { CostSource } from './cost-adapters.js';
import type { CostSession } from './cost-report.js';
/** A migrated generation supersedes earlier physical logs in the same session directory. */
export declare function currentDeepSeekLogs(files: string[]): string[];
/** DeepSeek Harness released JSONL formats v2–v4, including native Zstandard artifacts. */
export declare function readDeepSeekCosts(file: string, source: CostSource): Promise<CostSession[]>;
//# sourceMappingURL=cost-deepseek.d.ts.map