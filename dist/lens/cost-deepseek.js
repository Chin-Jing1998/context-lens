import * as fs from 'node:fs';
import * as readline from 'node:readline';
import * as zlib from 'node:zlib';
import * as path from 'node:path';
import { record } from './settings.js';
import { normalizeUsage } from './usage.js';
import { tokenNumber } from './context.js';
import { sanitizeDisplayText } from '../utils/sanitize.js';
const text = (v) => typeof v === 'string' ? sanitizeDisplayText(v).slice(0, 200) : '';
/** A migrated generation supersedes earlier physical logs in the same session directory. */
export function currentDeepSeekLogs(files) {
    const current = new Map(), other = [];
    for (const file of files) {
        const match = /^session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$/.exec(path.basename(file));
        if (!match) {
            other.push(file);
            continue;
        }
        const version = Number(match[1] ?? 0), dir = path.dirname(file), old = current.get(dir);
        if (!old || version > old.version || version === old.version && old.file.endsWith('.zstd') && !file.endsWith('.zstd'))
            current.set(dir, { file, version });
    }
    return [...current.values()].map(v => v.file).concat(other).sort();
}
/** DeepSeek Harness released JSONL formats v2–v4, including native Zstandard artifacts. */
export async function readDeepSeekCosts(file, source) {
    if (file.endsWith('.zstd') && typeof zlib.createZstdDecompress !== 'function')
        throw new Error('Zstandard accounting requires Node.js 22.15+');
    const raw = fs.createReadStream(file);
    const input = file.endsWith('.zstd') ? raw.pipe(zlib.createZstdDecompress()) : raw;
    if (input !== raw)
        raw.on('error', error => input.destroy(error));
    let session, seeded = false, model = '', complete = true, size = 0;
    const attempts = new Map(), requests = new Map();
    try {
        for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
            size += line.length;
            if (size > 512 * 1024 * 1024 || line.length > 8_000_000)
                throw new Error('Harness usage log exceeds limit');
            if (!line.trim())
                continue;
            let event;
            try {
                event = JSON.parse(line);
            }
            catch {
                complete = false;
                continue;
            }
            const data = record(event.data);
            if (!session) {
                if (event.type !== 'session' || ![2, 3, 4].includes(event.version) || !text(event.id))
                    throw new Error('Unsupported Harness session format');
                session = { tool: source.tool, toolName: source.toolName, id: text(event.id), parentId: text(event.parentSession) || undefined, requests: [], complete: true };
                seeded = event.isSeeded === true;
                continue;
            }
            if (event.type === 'session/end-seed' && data.inherited === true) {
                seeded = false;
                continue;
            }
            if (event.type === 'session/title')
                session.title = text(data.title) || session.title;
            if (event.type === 'request/context')
                model = text(data.model);
            if (seeded)
                continue;
            const slot = `${data.turn}:${data.step}`;
            if (event.type === 'llm/retry-started') {
                attempts.set(slot, (attempts.get(slot) ?? 0) + 1);
                continue;
            }
            if (!['assistant/message', 'assistant/attempt'].includes(event.type))
                continue;
            if (!Number.isSafeInteger(data.turn) || !Number.isSafeInteger(data.step)) {
                complete = false;
                continue;
            }
            const stream = Array.isArray(data.stream) ? data.stream : [];
            const sample = [...stream].reverse().map(c => c?.type === 'chunk' ? c.chunk : c).find(c => c?.type === 'usage');
            const usage = record(data.usage ?? sample?.usage);
            if (!Object.keys(usage).length)
                continue;
            const id = `${source.tool}:${session.id}:${slot}:${attempts.get(slot) ?? 0}`;
            const sourceModel = text(record(record(data.message).source).model) || model;
            const start = stream.find(c => tokenNumber(c?.time ?? c?.time0) !== null);
            const time = start?.time ?? start?.time0 ?? event.time;
            const at = typeof time === 'number' && Number.isFinite(new Date(time).getTime()) ? new Date(time).toISOString() : '';
            const row = normalizeUsage('claude', { input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
                cache_read_input_tokens: usage.cacheReadTokens ?? 0, cache_creation_input_tokens: usage.cacheWriteTokens ?? 0,
                reasoning_output_tokens: usage.reasoningTokens }, id, sourceModel, at);
            row.timestampKnown = !!at;
            // A settlement replaces its previous sample; a retry is a separate billed attempt.
            const previous = requests.get(id);
            if (previous?.timestampKnown && (!at || previous.at < at)) {
                row.at = previous.at;
                row.timestampKnown = true;
            }
            requests.set(id, row);
        }
    }
    finally {
        input.destroy();
        raw.destroy();
    }
    if (!session)
        return [];
    session.requests = [...requests.values()];
    session.complete = complete && !seeded;
    return [session];
}
//# sourceMappingURL=cost-deepseek.js.map