import type { DatabaseSync } from 'node:sqlite';
import { type ActivityLog } from './activity.js';
import type { SessionInfo } from './types.js';
/** 从同一数据库事务中的结构化执行步骤读取，参数仅用于提取名称。 */
export declare function readAgyActivities(db: DatabaseSync, info: SessionInfo): ActivityLog | undefined;
/** 较早日志仅在模型工具列表与后续连续执行结果一一对应时统计活动。 */
export declare class AgyTranscriptActivities {
    private info;
    private calls;
    private batch?;
    private complete;
    constructor(info: SessionInfo);
    accept(entry: Record<string, any>, index: number): void;
    private flush;
    finish(complete: boolean): ActivityLog;
}
//# sourceMappingURL=agy-activity.d.ts.map