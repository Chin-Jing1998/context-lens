import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as readline from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { record } from './settings.js';
import { tokenNumber } from './context.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { ZERO_TOKENS, mergeRequests, normalizeUsage } from './usage.js';
const text = (v, max = 200) => typeof v === 'string' ? sanitizeDisplayText(v).slice(0, max) : '';
const at = (v) => (typeof v === 'number' || typeof v === 'string') && Number.isFinite(new Date(v).getTime()) ? new Date(v).toISOString() : '';
const n = (v) => tokenNumber(v) ?? 0;
const run = promisify(execFile);
export function defaultCostSources() {
    const home = os.homedir(), data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    return [
        { tool: 'opencode', toolName: 'OpenCode', format: 'opencode', path: process.env.OPENCODE_DB || path.join(data, 'opencode', 'opencode.db') },
        { tool: 'mimocode', toolName: 'MiMo Code', format: 'opencode', path: process.env.MIMOCODE_DB || path.join(data, 'mimocode', 'mimocode.db') },
        { tool: 'zcode', toolName: 'ZCode', format: 'zcode', path: process.env.ZCODE_DB || path.join(home, '.zcode', 'cli', 'db', 'db.sqlite') },
        { tool: 'deepseek', toolName: 'DeepSeek Harness', format: 'deepseek', path: path.join(process.env.DSH_HOME || path.join(home, '.dsh'), 'sessions') },
    ];
}
/** Read just identity and accounting columns, never chat bodies, credentials or reported costs. */
async function sqlite(file, sql) {
    const result = await run('sqlite3', ['-readonly', '-json', file, sql], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 });
    return result.stdout.trim() ? JSON.parse(result.stdout) : [];
}
export async function readSqliteCosts(source) {
    const sessions = await sqlite(source.path, source.format === 'zcode' ? 'SELECT id, title, parent_id FROM session' : 'SELECT id, title, parent_id, time_created FROM session');
    const result = new Map(sessions.map(s => [s.id, { tool: source.tool, toolName: source.toolName, id: text(s.id), title: text(s.title), parentId: text(s.parent_id) || undefined, requests: [], complete: true }]));
    const created = new Map(sessions.map(s => [s.id, tokenNumber(s.time_created)]));
    let rows;
    if (source.format === 'zcode') {
        rows = await sqlite(source.path, `SELECT id, session_id, model_id, started_at, input_tokens, output_tokens, reasoning_tokens,
      cache_creation_input_tokens, cache_read_input_tokens FROM model_usage
      WHERE input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens > 0`);
    }
    else {
        rows = await sqlite(source.path, `SELECT id, session_id, time_created,
      json_extract(data, '$.modelID') AS model, json_extract(data, '$.tokens') AS tokens,
      json_extract(data, '$.time.created') AS created FROM message
      WHERE json_valid(data) AND json_extract(data, '$.role') = 'assistant'`);
    }
    for (const row of rows) {
        const session = result.get(row.session_id);
        if (!session)
            continue;
        let usage;
        if (source.format === 'zcode') {
            usage = normalizeUsage('claude', { input_tokens: row.input_tokens, output_tokens: row.output_tokens,
                cache_read_input_tokens: row.cache_read_input_tokens, cache_creation_input_tokens: row.cache_creation_input_tokens,
                reasoning_output_tokens: row.reasoning_tokens }, `${source.tool}:${text(row.id)}`, text(row.model_id), at(row.started_at));
        }
        else {
            const tokens = record(typeof row.tokens === 'string' ? JSON.parse(row.tokens) : row.tokens), cache = record(tokens.cache);
            // OpenCode and MiMo store disjoint input/cache and visible-output/reasoning buckets.
            usage = normalizeUsage('claude', { input_tokens: tokens.input, output_tokens: n(tokens.output) + n(tokens.reasoning),
                cache_read_input_tokens: cache.read, cache_creation_input_tokens: cache.write, reasoning_output_tokens: tokens.reasoning }, `${source.tool}:${text(row.id)}`, text(row.model), at(row.created ?? row.time_created));
            usage.complete &&= tokenNumber(tokens.output) !== null;
        }
        if (usage.input + usage.output === 0)
            continue;
        const sessionCreated = created.get(row.session_id);
        if (source.format === 'opencode' && sessionCreated && usage.at && Date.parse(usage.at) < sessionCreated) {
            // Forks retain original message timestamps and tokens while giving the copied messages new IDs.
            (session.excludedRequestIds ??= []).push(usage.id);
            continue;
        }
        usage.timestampKnown = !!usage.at;
        session.requests.push(usage);
    }
    return [...result.values()];
}
export function walkCostFiles(root, suffix, depth = 8) {
    const result = [];
    function walk(dir, left) {
        if (left < 0)
            return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch (e) {
            if (e.code === 'ENOENT')
                return;
            throw e;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink() || ['node_modules', '.git', 'cache', 'log', 'logs'].includes(entry.name))
                continue;
            const file = path.join(dir, entry.name);
            if (entry.isDirectory())
                walk(file, left - 1);
            else if (entry.isFile() && suffix.test(entry.name))
                result.push(file);
        }
    }
    walk(root, depth);
    return result;
}
export async function* costLines(file) {
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    try {
        for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
            if (!line.trim())
                continue;
            if (line.length > 8_000_000)
                throw new Error('Usage record exceeds size limit');
            yield JSON.parse(line);
        }
    }
    finally {
        input.destroy();
    }
}
/** Public accounting interchange; accepts arbitrary tool IDs, no filesystem paths or prose. */
export function validateCostSession(value) {
    const v = record(value);
    const valid = (s, limit) => typeof s === 'string' && s.length > 0 && s.length <= limit && !/[\x00-\x1f]/.test(s);
    if (!valid(v.tool, 80) || !valid(v.toolName, 100) || !valid(v.id, 200) || !Array.isArray(v.requests) || v.requests.length > 100000)
        throw new Error('Invalid cost session');
    const requests = v.requests.map((entry) => {
        const r = record(entry);
        if (!valid(r.id, 300) || typeof r.model !== 'string' || r.model.length > 200 || typeof r.at !== 'string'
            || (r.at !== '' && !Number.isFinite(Date.parse(r.at))) || typeof r.complete !== 'boolean')
            throw new Error('Invalid request');
        const row = { ...ZERO_TOKENS, id: r.id, model: r.model, at: r.at ? new Date(r.at).toISOString() : '', complete: r.complete, timestampKnown: r.timestampKnown !== false && !!r.at };
        for (const field of Object.keys(ZERO_TOKENS)) {
            if (tokenNumber(r[field]) === null)
                throw new Error('Invalid token count');
            row[field] = r[field];
        }
        if (row.cacheRead + row.cacheWrite > row.input || row.cacheWrite5m + row.cacheWrite1h > row.cacheWrite)
            throw new Error('Invalid token buckets');
        if (valid(r.serviceTier, 80))
            row.serviceTier = r.serviceTier;
        return row;
    });
    let excludedRequestIds;
    if (v.excludedRequestIds !== undefined) {
        if (!Array.isArray(v.excludedRequestIds) || v.excludedRequestIds.length > 100000 || v.excludedRequestIds.some((id) => !valid(id, 300)))
            throw new Error('Invalid excluded request IDs');
        excludedRequestIds = [...new Set(v.excludedRequestIds)];
    }
    const excluded = new Set(excludedRequestIds);
    return { tool: v.tool, toolName: text(v.toolName, 100), id: v.id, title: text(v.title) || undefined,
        parentId: valid(v.parentId, 200) ? v.parentId : undefined, complete: v.complete === true,
        ...(excludedRequestIds?.length ? { excludedRequestIds } : {}), requests: mergeRequests(requests).filter(r => !excluded.has(r.id)) };
}
//# sourceMappingURL=cost-adapters.js.map