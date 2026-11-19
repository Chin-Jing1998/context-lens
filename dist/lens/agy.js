import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { percentageNumber, tokenNumber } from './context.js';
import { mergeRequests, normalizeUsage, ZERO_TOKENS } from './usage.js';
import { atomicJson, lensHome, record } from './settings.js';
import { fields, nested, readVarint, string, timestamp } from './agy-wire.js';
import { agyContextBreakdown } from './agy-context.js';
import { AgyTranscriptActivities, readAgyActivities } from './agy-activity.js';
export const agyId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const maxBlob = 16 * 1024 * 1024;
const maxRead = 128 * 1024 * 1024;
const require = createRequire(import.meta.url);
const display = (value, limit = 200) => typeof value === 'string' ? sanitizeDisplayText(value).trim().slice(0, limit) : '';
const time = (value) => {
    const at = typeof value === 'string' ? Date.parse(value) : NaN;
    return Number.isFinite(at) ? at : undefined;
};
export const agyRoots = () => ({
    desktop: path.join(os.homedir(), '.gemini', 'antigravity'),
    cli: path.join(os.homedir(), '.gemini', 'antigravity-cli'),
});
function regular(file) {
    try {
        const stat = fs.lstatSync(file);
        return stat.isFile() ? stat : undefined;
    }
    catch {
        return undefined;
    }
}
export function agyHistory(root, id) {
    if (!agyId.test(id) || !regular(path.join(root, 'conversations', `${id}.pb`)))
        return undefined;
    const file = path.join(root, 'brain', id, '.system_generated', 'logs', 'transcript.jsonl');
    return regular(file) ? file : undefined;
}
export function agyStamp(file) {
    const stat = regular(file), wal = regular(file + '-wal');
    return [stat?.ino, stat?.size, stat?.mtimeMs, wal?.ino, wal?.size, wal?.mtimeMs].join(':');
}
function open(file) {
    if (!regular(file))
        throw new Error('Antigravity 数据库已移除');
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(file, { readOnly: true, timeout: 150, allowExtension: false });
    try {
        db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=150');
    }
    catch (error) {
        db.close();
        throw error;
    }
    return db;
}
function workspace(value) {
    try {
        if (typeof value !== 'string' || value.length > 32_768)
            return '';
        const uris = JSON.parse(value);
        if (Array.isArray(uris))
            for (const uri of uris) {
                if (typeof uri !== 'string' || !uri.startsWith('file://'))
                    continue;
                try {
                    return display(fileURLToPath(uri), 4096);
                }
                catch { /* 跳过非本地工作区。 */ }
            }
    }
    catch { /* 较早的版本可能缺少工作区信息。 */ }
    return '';
}
const indexes = new Map();
export function discoverAgySessions(roots = agyRoots()) {
    const byId = new Map();
    for (const surface of ['desktop', 'cli']) {
        const root = roots[surface];
        if (!root)
            continue;
        const index = path.join(root, 'conversation_summaries.db'), directory = path.join(root, 'conversations');
        try {
            if (!fs.lstatSync(directory).isDirectory() || !regular(index))
                continue;
            const stamp = agyStamp(index), old = indexes.get(index);
            let rows = old?.rows ?? [];
            if (old?.stamp !== stamp) {
                try {
                    const db = open(index);
                    try {
                        rows = db.prepare(`SELECT conversation_id, title, workspace_uris, last_modified_time,
            last_user_input_time, parent_conversation_id FROM conversation_summaries`).all();
                    }
                    finally {
                        db.close();
                    }
                    if (indexes.size >= 8 && !indexes.has(index))
                        indexes.delete(indexes.keys().next().value);
                    indexes.set(index, { stamp, rows });
                }
                catch { /* 活跃索引被短暂锁定时沿用上次成功读取的身份。 */ }
            }
            for (const row of rows) {
                const id = row.conversation_id;
                if (typeof id !== 'string' || !agyId.test(id))
                    continue;
                let file = path.join(directory, `${id}.db`), stat = regular(file);
                if (!stat && surface === 'cli') {
                    const history = agyHistory(root, id);
                    if (history) {
                        file = history;
                        stat = regular(file);
                    }
                }
                // 两端的索引都可能列出对方的会话，以同一数据根下的会话文件确认归属。
                if (!stat)
                    continue;
                const lastUserAt = time(row.last_user_input_time), parentId = row.parent_conversation_id;
                const updatedAt = new Date(time(row.last_modified_time) ?? stat.mtimeMs).toISOString();
                const info = { id, client: 'agy', surface, file, cwd: workspace(row.workspace_uris), model: '',
                    updatedAt, size: stat.size, mtimeMs: stat.mtimeMs, lastUserAt, title: display(row.title) || '未命名对话',
                    ...(typeof parentId === 'string' && agyId.test(parentId) && parentId !== id ? { parentId } : {}) };
                const matches = byId.get(id) ?? [];
                matches.push(info);
                byId.set(id, matches);
            }
        }
        catch { /* 相应客户端未安装或数据目录暂不可读。 */ }
    }
    return [...byId.values()].filter(matches => matches.length === 1).map(([info]) => info);
}
function requestUsage(usage, info, index, model, at, executionId = '') {
    const numeric = [2, 3, 4, 5, 9].map(key => usage.has(key) ? tokenNumber(usage.get(key)) : 0);
    if (!numeric.every(value => value !== null) || !numeric.some(value => value > 0))
        return undefined;
    const [uncached, output, cacheWrite, cacheRead, reasoning] = numeric;
    const id = string(usage.get(11)) || string(usage.get(7)) || string(usage.get(12)) || executionId;
    const serviceTier = string(usage.get(13));
    const input = uncached + cacheRead + cacheWrite;
    if (!Number.isSafeInteger(input))
        return undefined;
    return { ...ZERO_TOKENS, id: id ? `agy:${id}` : `agy:${info.id}:${index}`, model,
        at: at ?? info.updatedAt, timestampKnown: at !== undefined,
        input, uncachedInput: uncached, output, cacheRead, cacheWrite, reasoning, complete: true,
        ...(cacheWrite > 0 ? { missingTokens: ['cacheWrite5m', 'cacheWrite1h'] } : {}), ...(serviceTier ? { serviceTier } : {}) };
}
const usageFields = [1, 2, 3, 4, 5, 7, 9, 11, 12, 13];
function generation(data, info, index, stepTime) {
    const metadata = fields(data, [1, 2, 4]);
    // CortexStepGeneratorMetadata.chat_model → ChatModelMetadata.chat_start_metadata → ContextWindowMetadata。
    const chat = nested(metadata.get(1), [3, 4, 9, 19, 21]);
    const start = nested(chat.get(9), [4, 10]), window = nested(start.get(10), [1, 3, 4]);
    const indices = metadata.get(2);
    const first = indices instanceof Uint8Array && indices.length ? readVarint(indices, 0)[0] : indices;
    const at = timestamp(start.get(4)) ?? (typeof first === 'number' && Number.isSafeInteger(first) ? stepTime(first) : undefined);
    const modelName = string(chat.get(21)), model = string(chat.get(19));
    const usage = nested(chat.get(4), usageFields);
    const request = requestUsage(usage, info, String(index), model || modelName, at, string(metadata.get(4)));
    return { model, modelName, modelNumber: tokenNumber(usage.get(1) ?? chat.get(3)),
        used: tokenNumber(window.get(1)) || null, capacity: tokenNumber(window.get(4)) || null, breakdown: window.get(3), at, request };
}
export function readAgySession(file) {
    const { id, client, surface, cwd, title, updatedAt, parentId } = file;
    const info = { id, client, surface, cwd, title, updatedAt, parentId, model: '' };
    const db = open(file.file);
    try {
        db.exec('BEGIN');
        const identity = db.prepare('SELECT cascade_id FROM trajectory_meta').get();
        if (identity?.cascade_id !== id)
            throw new Error('Antigravity 会话数据库的身份与索引不符');
        const result = { info, used: null, capacity: null, requests: [], categories: {},
            runtime: {}, warnings: [], complete: true, compacted: false };
        const hasSteps = db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='steps'").get();
        const metadataAt = hasSteps ? db.prepare(`SELECT metadata FROM steps WHERE idx=? AND length(metadata)<=${maxBlob}`) : undefined;
        const stepTime = (index) => {
            const metadata = metadataAt?.get(index)?.metadata;
            return metadata instanceof Uint8Array ? timestamp(fields(metadata, [1]).get(1)) : undefined;
        };
        const entries = db.prepare(`SELECT idx, length(data) AS bytes, CASE WHEN length(data) <= ${maxBlob} THEN data END AS data
      FROM gen_metadata ORDER BY idx DESC`).iterate();
        let bytes = 0, last = null, first = null, sameModel = true;
        const models = new Map();
        const observe = (stamp) => {
            if (!stamp)
                return;
            const at = Date.parse(stamp);
            last = last === null ? at : Math.max(last, at);
            first = first === null ? at : Math.min(first, at);
        };
        for (const row of entries) {
            if (typeof row.bytes === 'number' && (bytes += row.bytes) > maxRead) {
                result.complete = false;
                break;
            }
            if (!(row.data instanceof Uint8Array) || typeof row.idx !== 'number') {
                result.complete = false;
                continue;
            }
            try {
                const item = generation(row.data, info, row.idx, stepTime);
                if (item.model || item.modelName) {
                    if (!info.model) {
                        info.model = item.model || item.modelName;
                        info.modelName = item.modelName || undefined;
                    }
                    sameModel &&= info.model === (item.model || item.modelName);
                    if (sameModel && result.at === undefined && (item.used !== null || item.capacity !== null)) {
                        result.used = item.used ?? item.request?.input ?? null;
                        result.capacity = item.capacity;
                        result.windowEstimated = item.used !== null;
                        result.at = item.at ?? info.updatedAt;
                        if (item.used !== null && item.breakdown) {
                            try {
                                const detail = agyContextBreakdown(item.breakdown, item.used, result.at);
                                if (detail) {
                                    result.categories = detail.categories;
                                    result.messageBreakdown = detail.messageBreakdown;
                                }
                            }
                            catch { /* 分类暂不可读时仍使用这一快照的总量和用量。 */ }
                        }
                    }
                }
                if (item.modelNumber !== null && item.model) {
                    const names = models.get(item.modelNumber) ?? new Set();
                    names.add(item.model);
                    models.set(item.modelNumber, names);
                }
                if (item.request)
                    result.requests.push(item.request);
                observe(item.at);
            }
            catch {
                result.complete = false;
            }
        }
        const latest = result.requests[0];
        if (hasSteps) {
            try {
                result.activity = readAgyActivities(db, info);
            }
            catch {
                result.activity = { calls: [], complete: false };
            }
            // CHECKPOINT 的压缩请求单独存放在 steps，普通模型请求已由 gen_metadata 计量。
            const checkpoints = db.prepare(`SELECT idx, length(metadata) AS bytes, CASE WHEN length(metadata)<=${maxBlob} THEN metadata END AS metadata
        FROM steps WHERE step_type=23 ORDER BY idx DESC`).iterate();
            for (const row of checkpoints) {
                if (typeof row.bytes === 'number' && (bytes += row.bytes) > maxRead) {
                    result.complete = false;
                    break;
                }
                if (!(row.metadata instanceof Uint8Array) || typeof row.idx !== 'number') {
                    result.complete = false;
                    continue;
                }
                try {
                    const step = fields(row.metadata, [1, 9, 12]);
                    const usage = nested(step.get(9), usageFields), number = tokenNumber(usage.get(1));
                    const names = number === null ? undefined : models.get(number);
                    const at = timestamp(step.get(1));
                    const request = requestUsage(usage, info, `checkpoint:${row.idx}`, names?.size === 1 ? [...names][0] : '', at, string(step.get(12)));
                    if (request) {
                        result.requests.push(request);
                        observe(at);
                    }
                }
                catch {
                    result.complete = false;
                }
            }
        }
        result.requests = mergeRequests(result.requests.reverse());
        if (result.used === null && result.at === undefined) {
            if (latest?.model && latest.model === info.model && latest.input > 0) {
                result.used = latest.input;
                result.at = latest.at;
            }
        }
        if (first !== null)
            result.timing = { startedAt: first, reportedStart: false, lastActivityAt: last, turns: [], complete: false };
        if (!result.complete)
            result.warnings.push('Antigravity 的部分请求记录暂不可读');
        return result;
    }
    finally {
        db.close();
    }
}
export async function readAgyTranscript(file) {
    const { id, client, surface, cwd, title, updatedAt, parentId } = file;
    const info = { id, client, surface, cwd, title, updatedAt, parentId, model: '' };
    const result = { info, used: null, capacity: null, requests: [], categories: {},
        runtime: {}, warnings: [], complete: true, compacted: false };
    const activities = new AgyTranscriptActivities(info);
    const fd = fs.openSync(file.file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const stream = fs.createReadStream(file.file, { encoding: 'utf8', fd });
    let first = null, last = null;
    try {
        for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
            if (!line.trim())
                continue;
            if (line.length > maxBlob) {
                result.complete = false;
                continue;
            }
            try {
                const entry = record(JSON.parse(line)), at = time(entry.created_at), index = tokenNumber(entry.step_index);
                if (at !== undefined) {
                    first ??= at;
                    last = at;
                }
                if (index !== null)
                    activities.accept(entry, index);
                if (index === null || tokenNumber(entry.input_tokens) === null || !['PLANNER_RESPONSE', 'CHECKPOINT'].includes(entry.type))
                    continue;
                const model = display(entry.model);
                const request = normalizeUsage('agy', { input_tokens: entry.input_tokens, output_tokens: entry.output_tokens,
                    cache_read_input_tokens: entry.cache_read_tokens, cache_creation_input_tokens: entry.cache_write_tokens,
                    reasoning_output_tokens: entry.thinking_tokens }, `agy:${id}:step:${index}`, model, at === undefined ? updatedAt : new Date(at).toISOString());
                request.timestampKnown = at !== undefined;
                result.requests.push(request);
                if (entry.type === 'PLANNER_RESPONSE') {
                    info.model = model || info.model;
                    result.used = request.input || null;
                    result.at = request.at;
                }
            }
            catch {
                result.complete = false;
            }
        }
    }
    finally {
        stream.destroy();
    }
    result.requests = mergeRequests(result.requests);
    result.activity = activities.finish(result.complete);
    if (first !== null)
        result.timing = { startedAt: first, reportedStart: false, lastActivityAt: last, turns: [], complete: false };
    return result;
}
const livePath = (id) => path.join(lensHome(), 'live', `agy-cli-${id}.json`);
export async function captureAgyStatusline() {
    let body = '';
    for await (const chunk of process.stdin) {
        body += chunk.toString();
        if (body.length > 65_536)
            return;
    }
    try {
        const data = record(JSON.parse(body));
        const id = data.conversation_id ?? data.session_id;
        if (typeof id !== 'string' || !agyId.test(id) || data.product !== undefined && data.product !== 'antigravity')
            return;
        const window = record(data.context_window), model = record(data.model), current = record(window.current_usage);
        const size = tokenNumber(window.context_window_size) || null;
        const used = tokenNumber(window.total_input_tokens), input = tokenNumber(current.input_tokens);
        const usage = used && input !== null ? [used, input, tokenNumber(current.output_tokens), tokenNumber(current.cache_read_input_tokens)].join(':') : undefined;
        // 只保存会话身份和窗口读数，账本继续以数据库中的请求为准。
        const live = { id, at: new Date().toISOString(), model: display(model.id) || display(model.display_name),
            size, percent: size !== null ? percentageNumber(window.used_percentage) || null : null, usage };
        if (size === null && usage) {
            const previous = readAgyLive({ id, client: 'agy', surface: 'cli', model: live.model, cwd: '', updatedAt: live.at });
            if (previous?.size && previous.usage === usage)
                return;
        }
        atomicJson(livePath(id), live);
    }
    catch { /* 状态行仍由原生 CLI 正常绘制。 */ }
}
export function readAgyLive(info, lastContextAt) {
    if (info.surface !== 'cli' || !agyId.test(info.id))
        return undefined;
    try {
        const file = livePath(info.id), stat = regular(file);
        if (!stat || stat.size > 4096)
            return undefined;
        const live = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (live.id !== info.id || live.model !== info.model && live.model !== info.modelName || typeof live.at !== 'string')
            return undefined;
        const at = Date.parse(live.at);
        if (!Number.isFinite(at) || at > Date.now() + 60_000 || lastContextAt && at < Date.parse(lastContextAt))
            return undefined;
        const size = tokenNumber(live.size) || null;
        return { ...live, size, percent: size !== null ? percentageNumber(live.percent) || null : null };
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=agy.js.map