import { commandName, mcpTarget, skillName } from './activity.js';
import { fields, nested, string, timestamp } from './agy-wire.js';
import { record } from './settings.js';
function jsonObject(value) {
    if (typeof value !== 'string')
        return record(value);
    if (value.length > 65_536)
        return {};
    try {
        return record(JSON.parse(value));
    }
    catch {
        return {};
    }
}
function target(tool, args, cwd) {
    if (tool === 'run_command')
        return { kind: 'commands', name: commandName(args.CommandLine), detail: '', action: 'run' };
    if (tool === 'call_mcp_tool' && typeof args.ServerName === 'string' && typeof args.ToolName === 'string') {
        return { kind: 'mcp', action: 'invoke', ...mcpTarget(args.ServerName, args.ToolName, args.Arguments) };
    }
    if (tool === 'read_file') {
        const name = skillName(args.Path, cwd);
        if (name)
            return { kind: 'skills', name, detail: 'SKILL.md', action: 'read' };
    }
}
const stepStatuses = {
    2: 'running', 3: 'succeeded', 4: 'failed', 6: 'failed', 7: 'failed', 12: 'failed',
};
const transcriptStatuses = {
    RUNNING: 'running', DONE: 'succeeded', INVALID: 'failed', CANCELED: 'failed', ERROR: 'failed', INTERRUPTED: 'failed',
};
const payloadLimit = 16 * 1024 * 1024;
const activityReadLimit = 48 * 1024 * 1024;
function resultPayload(payload, tool) {
    // CortexStep.generic → GenericStepResult.payload，是按工具类型打包的 Any。
    const generic = nested(nested(payload, [140]).get(140), [2]);
    const result = nested(nested(generic.get(2), [6]).get(6), [1, 2]);
    return string(result.get(1)) === `type.googleapis.com/exa.cortex.core.tools.${tool}` ? result.get(2) : undefined;
}
/** 从同一数据库事务中的结构化执行步骤读取，参数仅用于提取名称。 */
export function readAgyActivities(db, info) {
    const columns = new Set(db.prepare('PRAGMA table_info(steps)').all().map(row => row.name));
    if (!columns.has('metadata') || !columns.has('status') || !columns.has('step_payload'))
        return undefined;
    const calls = new Map();
    // 终止、错误和运行中的步骤可显示。排队、生成中及清除的步骤不计为执行。
    const steps = db.prepare(`SELECT idx, status, length(metadata) AS bytes,
    CASE WHEN length(metadata) <= ${payloadLimit} THEN metadata END AS metadata
    FROM steps WHERE step_type = 132 AND status IN (2, 3, 4, 6, 7, 12) ORDER BY idx DESC`).iterate();
    const getPayload = db.prepare(`SELECT CASE WHEN length(step_payload) <= ${payloadLimit} THEN step_payload END AS data,
    length(step_payload) AS bytes FROM steps WHERE idx = ?`);
    let complete = true, bytes = 0;
    for (const row of steps) {
        if (typeof row.bytes === 'number' && (bytes += row.bytes) > activityReadLimit) {
            complete = false;
            break;
        }
        if (!(row.metadata instanceof Uint8Array) || typeof row.idx !== 'number' || typeof row.status !== 'number') {
            complete = false;
            continue;
        }
        try {
            const metadata = fields(row.metadata, [1, 4, 8, 32]);
            const call = nested(metadata.get(4), [1, 2, 3]);
            const tool = string(call.get(2)), raw = call.get(3);
            if (!['run_command', 'call_mcp_tool', 'read_file'].includes(tool))
                continue;
            if (raw instanceof Uint8Array && raw.length > 65_536) {
                complete = false;
                continue;
            }
            const args = jsonObject(raw instanceof Uint8Array ? Buffer.from(raw).toString('utf8') : undefined);
            const item = target(tool, args, info.cwd);
            if (!item)
                continue;
            let status = stepStatuses[row.status];
            let exitCode = null;
            if (item.kind === 'commands' && status === 'succeeded') {
                const payload = getPayload.get(row.idx);
                if (typeof payload?.bytes === 'number' && (bytes += payload.bytes) > activityReadLimit) {
                    complete = false;
                    break;
                }
                const result = payload?.data instanceof Uint8Array ? resultPayload(payload.data, 'RunCommand') : undefined;
                if (result instanceof Uint8Array) {
                    const state = fields(result, [1, 2, 8]);
                    const code = state.get(1) ?? 0;
                    if (state.get(8) !== 1 && typeof code === 'number' && Number.isSafeInteger(code))
                        exitCode = code;
                    status = state.get(2) === 1 || exitCode !== null && exitCode !== 0 ? 'failed' : exitCode === 0 ? 'succeeded' : 'unknown';
                }
                else
                    status = 'unknown';
            }
            const started = timestamp(metadata.get(32)), ended = timestamp(metadata.get(8));
            const elapsed = started && ended ? Date.parse(ended) - Date.parse(started) : -1;
            const callId = string(call.get(1));
            const id = callId ? `agy:tool:${callId}` : `agy:${info.id}:step:${row.idx}`;
            if (!calls.has(id))
                calls.set(id, { ...item, id, status, exitCode, at: started ?? timestamp(metadata.get(1)) ?? null,
                    durationMs: status !== 'running' && status !== 'unknown' && elapsed >= 0 ? elapsed : null });
        }
        catch {
            complete = false;
        }
    }
    return { calls: [...calls.values()], complete };
}
/** 较早日志仅在模型工具列表与后续连续执行结果一一对应时统计活动。 */
export class AgyTranscriptActivities {
    info;
    calls = new Map();
    batch;
    complete = true;
    constructor(info) {
        this.info = info;
    }
    accept(entry, index) {
        if (entry.type === 'GENERIC' && this.batch) {
            if (index === this.batch.index + this.batch.results.length + 1)
                this.batch.results.push({ step_index: index, status: entry.status, created_at: entry.created_at });
            else {
                this.complete = false;
                this.batch = undefined;
            }
            return;
        }
        if (!['PLANNER_RESPONSE', 'USER_INPUT', 'CHECKPOINT'].includes(entry.type))
            return;
        this.flush();
        if (entry.type === 'PLANNER_RESPONSE' && Array.isArray(entry.tool_calls) && entry.tool_calls.length) {
            this.batch = { index, tools: entry.tool_calls, results: [] };
        }
    }
    flush() {
        const batch = this.batch;
        this.batch = undefined;
        if (!batch)
            return;
        if (batch.tools.length !== batch.results.length) {
            this.complete = false;
            return;
        }
        for (const [index, value] of batch.tools.entries()) {
            const tool = record(value), result = batch.results[index];
            const status = typeof result.status === 'string' && Object.hasOwn(transcriptStatuses, result.status) ? transcriptStatuses[result.status] : undefined;
            if (!status)
                continue;
            const item = target(tool.name, jsonObject(tool.args), this.info.cwd);
            if (!item)
                continue;
            const id = `agy:${this.info.id}:step:${result.step_index}`;
            const at = typeof result.created_at === 'string' ? Date.parse(result.created_at) : NaN;
            this.calls.set(id, { ...item, id, at: Number.isFinite(at) ? new Date(at).toISOString() : null,
                status: item.kind === 'commands' && status === 'succeeded' ? 'unknown' : status, exitCode: null, durationMs: null });
        }
    }
    finish(complete) {
        this.flush();
        return { calls: [...this.calls.values()], complete: complete && this.complete };
    }
}
//# sourceMappingURL=agy-activity.js.map