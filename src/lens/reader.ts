import * as fs from 'node:fs';
import * as readline from 'node:readline';
import { createRequire } from 'node:module';
import type { getEncoding } from 'js-tiktoken';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { CATEGORIES, tokenNumber } from './context.js';
import { mergeRequests, normalizeUsage } from './usage.js';
import { record } from './settings.js';
import type { Category, Measurement, RequestUsage, SessionInfo } from './types.js';

export interface ParsedSession {
  info: SessionInfo; requests: RequestUsage[]; cumulative?: RequestUsage;
  used: number | null; capacity: number | null; at?: string;
  categories: Partial<Record<Category, Measurement>>;
  buffer?: Measurement & { placement: 'inside' | 'outside' };
  runtime: Record<string, unknown>; warnings: string[]; complete: boolean;
  compacted: boolean;
}
let tokenizer: ReturnType<typeof getEncoding> | undefined;
const require = createRequire(import.meta.url);
function estimate(text: unknown, source: string, at: string): Measurement | undefined {
  if (typeof text !== 'string' || !text || text.length > 2_000_000) return undefined;
  tokenizer ??= require('js-tiktoken').getEncoding('o200k_base');
  return { tokens: tokenizer!.encode(text, [], []).length, accuracy: 'estimated', source: `${source}; approximate o200k_base encoding`, at };
}
const display = (value: unknown, max = 160): string => typeof value === 'string' ? sanitizeDisplayText(value).slice(0, max) : '';
const timestamp = (value: unknown, fallback: string): string => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : fallback;

/** Only a local /context command's output is a diagnostic, never assistant/tool prose. */
function contextDiagnostic(text: unknown, at: string): Partial<Record<Category, Measurement>> {
  if (typeof text !== 'string' || !text.includes('<local-command-stdout>')) return {};
  text = sanitizeDisplayText(text);
  const result: Partial<Record<Category, Measurement>> = {};
  for (const [id, label] of CATEGORIES) {
    const name = id === 'messages' ? '(?:Messages|Conversation)' : label;
    const m = new RegExp(`${name}\\s*(?:[:|]\\s*)?([\\d,.]+\\s*[kKmM]?)\\s*(?:tokens|[|\\(])`, 'i').exec(text as string);
    if (!m) continue;
    const raw = m[1].replaceAll(',', '').replaceAll(' ', '');
    const value = Number(raw.replace(/[kKmM]$/, '')) * (/m$/i.test(raw) ? 1e6 : /k$/i.test(raw) ? 1e3 : 1);
    if (tokenNumber(value) !== null) result[id] = { tokens: value, source: 'Claude /context diagnostic (rounded display)', accuracy: 'reported', at };
  }
  return result;
}

export async function parseEvents(info: SessionInfo, events: AsyncIterable<unknown> | Iterable<unknown>): Promise<ParsedSession> {
  const result: ParsedSession = { info: { ...info }, requests: [], used: null, capacity: null,
    categories: {}, runtime: {}, warnings: [], complete: true, compacted: false };
  let model = info.model;
  let ownTurn = !info.parentId;
  let legacy: RequestUsage | undefined;
  let legacyBaseline: RequestUsage | undefined;
  let modernTotal: RequestUsage | undefined;
  const seen = new Set<string>();
  let lastContextId = '';
  for await (const value of events) {
    const entry = record(value);
    const at = timestamp(entry.timestamp, info.updatedAt);
    if (info.client === 'claude') {
      if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
        result.used = null; result.at = at; result.categories = {}; result.buffer = undefined; result.compacted = true;
      }
      if (entry.type === 'system' && entry.subtype === 'local_command' && record(entry.commandRun).command === 'context') {
        const diagnostic = record(entry.contextUsage);
        if (tokenNumber(diagnostic.total_tokens) !== null && Array.isArray(diagnostic.categories)) {
          result.categories = {}; result.buffer = undefined;
          result.used = diagnostic.total_tokens; result.capacity = tokenNumber(diagnostic.raw_max_tokens);
          result.at = at; result.compacted = false; model = display(diagnostic.model) || model;
          for (const item of diagnostic.categories) {
            const category = CATEGORIES.find(([id, label]) => label.toLowerCase() === String(item?.name).toLowerCase()
              || (id === 'messages' && item?.name === 'Messages'));
            if (!category || tokenNumber(item.tokens) === null) continue;
            const measurement: Measurement = { tokens: item.tokens, accuracy: 'reported', source: 'Claude /context structured contextUsage', at };
            if (category[0] === 'buffer') result.buffer = { ...measurement, placement: 'inside' };
            else if (!['free', 'unclassified'].includes(category[0])) result.categories[category[0]] = measurement;
          }
        }
      }
      if (entry.type === 'user') {
        const diagnostic = contextDiagnostic(record(entry.message).content, at);
        if (Object.keys(diagnostic).length) {
          result.categories = diagnostic;
          if (diagnostic.buffer) result.buffer = { ...diagnostic.buffer, placement: 'inside' };
          delete result.categories.buffer; delete result.categories.free; delete result.categories.unclassified;
        }
      }
      if (entry.type !== 'assistant') continue;
      const message = record(entry.message);
      if (!message.usage || !Object.keys(record(message.usage)).length) continue;
      const id = display(message.id || entry.requestId, 200);
      if (!id) { result.complete = false; result.warnings.push('Assistant usage without a response ID was excluded from deduplicated totals'); continue; }
      const nextModel = display(message.model) || model;
      const row = normalizeUsage('claude', record(message.usage), `claude:${id}`, nextModel, at);
      result.requests.push(row);
      if ((!seen.has(id) || (lastContextId === id && !result.compacted)) && (entry.isSidechain !== true || info.parentId)) {
        if (model && nextModel !== model) { result.categories = {}; result.capacity = null; result.buffer = undefined; }
        model = nextModel; result.used = row.input; result.at = at; result.compacted = false; lastContextId = id;
      }
      seen.add(id);
      result.info.cwd = display(entry.cwd, 4096) || result.info.cwd;
    } else {
      const payload = record(entry.payload);
      if (entry.type === 'session_meta') {
        // A fork can carry parent history. Only metadata for this session is authoritative.
        if (payload.id && payload.id !== info.id) continue;
        result.info.cwd = display(payload.cwd, 4096) || result.info.cwd;
        const base = estimate(record(payload.base_instructions).text, 'Codex session_meta.base_instructions', at);
        if (base) result.categories.systemPrompt = base;
      }
      if (entry.type === 'turn_context') {
        ownTurn = true;
        const nextModel = display(payload.model) || model;
        if (model && nextModel !== model) result.categories = {};
        model = nextModel;
        for (const key of ['model_auto_compact_token_limit', 'model_auto_compact_token_limit_scope', 'model_context_window'])
          if (Object.hasOwn(payload, key)) result.runtime[key] = payload[key];
      }
      if (entry.type === 'world_state') {
        const state = record(payload.state);
        if (payload.full === true) { delete result.categories.skills; delete result.categories.memoryFiles; }
        if (Object.hasOwn(state, 'agents_md')) {
          const value = estimate(record(state.agents_md).text, 'Codex world_state.agents_md (loaded)', at);
          if (value) result.categories.memoryFiles = value; else delete result.categories.memoryFiles;
        }
        if (Object.hasOwn(state, 'host_skills')) {
          const skills = record(state.host_skills);
          const value = skills.includeInstructions === false ? undefined : estimate(skills.body, 'Codex world_state.host_skills (loaded)', at);
          if (value) result.categories.skills = value; else delete result.categories.skills;
        }
      }
      if (entry.type === 'compacted' || (entry.type === 'event_msg' && ['context_compacted', 'compaction_completed'].includes(payload.type))) {
        result.used = null; result.at = at; result.categories = {}; result.compacted = true;
      }
      if (entry.type === 'token_usage_record' && (!payload.thread_id || payload.thread_id === info.id)) {
        const id = display(payload.response_id, 200);
        if (!id) { result.complete = false; continue; }
        const row = normalizeUsage('codex', record(payload.usage), `codex:${id}`, display(payload.model) || model, at);
        result.requests.push(row);
        if (!seen.has(id) || (lastContextId === id && !result.compacted)) {
          result.used = row.input + row.output; result.at = at; result.compacted = false; lastContextId = id;
        }
        seen.add(id);
        if (payload.thread_token_usage) {
          const total = normalizeUsage('codex', payload.thread_token_usage, 'cumulative', '', at);
          modernTotal = mergeRequests([...(modernTotal ? [modernTotal] : []), total])[0];
        }
      }
      if (entry.type === 'event_msg' && payload.type === 'token_count' && payload.info) {
        const usage = record(payload.info);
        const last = normalizeUsage('codex', record(usage.last_token_usage), 'last', model, at);
        const advanced = legacy && (Number(usage.total_token_usage?.input_tokens) > legacy.input || Number(usage.total_token_usage?.output_tokens) > legacy.output);
        if (ownTurn && usage.last_token_usage && (!result.compacted || advanced) && (!result.at || at >= result.at)) {
          result.used = last.input + last.output; result.at = at; result.compacted = false;
        }
        result.capacity = tokenNumber(usage.model_context_window) ?? result.capacity;
        if (usage.total_token_usage) {
          const total = normalizeUsage('codex', usage.total_token_usage, 'cumulative', '', at);
          if (info.parentId && !legacyBaseline) {
            // A child's copied prefix is not billed again. Without request IDs this boundary is only an estimate.
            legacyBaseline = { ...total };
            for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const)
              legacyBaseline[key] = Math.max(0, total[key] - (ownTurn ? last[key] : 0));
          }
          legacy = total;
        }
      }
    }
  }
  result.info.model = model || 'unknown';
  result.requests = mergeRequests(result.requests);
  result.cumulative = modernTotal ?? legacy;
  if (!modernTotal && legacy && legacyBaseline) {
    result.cumulative = { ...legacy, complete: false };
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const)
      result.cumulative[key] = Math.max(0, legacy[key] - legacyBaseline[key]);
    result.warnings.push('Legacy child totals use an estimated inherited-history baseline');
  }
  if (result.compacted) result.warnings.push('Compacted; waiting for the next valid context measurement');
  result.warnings = [...new Set(result.warnings)];
  return result;
}

export async function readSession(file: string, info: SessionInfo): Promise<ParsedSession> {
  let malformed = false;
  async function* entries() {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    try {
      for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) {
        if (!line.trim()) continue;
        if (line.length > 8_000_000) { malformed = true; continue; }
        try { yield JSON.parse(line); } catch { malformed = true; }
      }
    } finally { stream.destroy(); }
  }
  const result = await parseEvents(info, entries());
  if (malformed) { result.complete = false; result.warnings.push('Incomplete or invalid log lines were skipped'); }
  return result;
}
