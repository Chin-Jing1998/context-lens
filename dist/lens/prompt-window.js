import { createHash } from 'node:crypto';
import { record } from './settings.js';
const hash = (text) => createHash('sha256').update(text).digest('hex');
const plain = (value) => typeof value === 'string' ? value : '';
/** Text visible in a prompt. Images, encrypted reasoning and installed inventories are excluded. */
function textBlocks(value) {
    if (typeof value === 'string')
        return value ? [value] : [];
    if (!Array.isArray(value))
        return [];
    return value.flatMap(value => {
        const block = record(value);
        if (['text', 'input_text', 'output_text', 'summary_text'].includes(block.type))
            return plain(block.text) ? [block.text] : [];
        if (block.type === 'thinking')
            return plain(block.thinking) ? [block.thinking] : [];
        if (block.type === 'tool_result')
            return textBlocks(block.content);
        if (block.type === 'tool_use' && typeof block.name === 'string')
            return [block.name, JSON.stringify(block.input ?? {})];
        return [];
    });
}
function instructionCategory(kind, role) {
    if (kind === 'host_skills.instructions')
        return 'skills';
    if (['agents_md.instructions', 'memories.instructions'].includes(kind))
        return 'memoryFiles';
    if (kind.endsWith('.instructions') || kind === 'environments.environment_context' || kind === 'plugins.recommendations')
        return 'systemPrompt';
    if (role === 'developer' || role === 'system')
        return 'systemPrompt';
    return undefined;
}
/** Retains one prompt window, then tokenizes only its latest measured checkpoint. */
export class PromptWindow {
    info;
    estimate;
    parts = new Map();
    prefixes = new Map();
    seen = new Set();
    aliases = new Map();
    checkpoint;
    revision = 0;
    diagnosticRevision = null;
    ownStart = null;
    constructor(info, estimate) {
        this.info = info;
        this.estimate = estimate;
    }
    reset(preserved = []) {
        const keep = new Set(preserved.flatMap(id => [...(this.aliases.get(id) ?? [])]));
        this.parts = new Map([...this.parts].filter(([key]) => keep.has(key)));
        this.prefixes.clear();
        this.checkpoint = undefined;
        this.diagnosticRevision = null;
        this.revision++;
    }
    diagnostic() { this.checkpoint = undefined; this.diagnosticRevision = this.revision; }
    invalidate() { this.checkpoint = undefined; this.diagnosticRevision = null; }
    mark(at, excludeOwner) {
        if (this.diagnosticRevision !== null && this.revision <= this.diagnosticRevision)
            return;
        this.diagnosticRevision = null;
        this.checkpoint = { parts: [...this.prefixes.values(), ...this.parts.values()].filter(p => !excludeOwner || p.owner !== excludeOwner), at };
    }
    put(key, part, restore = false, alias) {
        if (alias) {
            const keys = this.aliases.get(alias) ?? new Set();
            keys.add(key);
            this.aliases.set(alias, keys);
        }
        const version = key + ':' + hash(part.text);
        if (!restore && this.seen.has(version))
            return;
        this.seen.add(version);
        this.parts.set(key, part);
        this.revision++;
    }
    prefix(key, text, category, at) {
        if (this.prefixes.get(key)?.text === text)
            return;
        if (text)
            this.prefixes.set(key, { text, category, at });
        else
            this.prefixes.delete(key);
        this.revision++;
    }
    codexItem(payload, at, restore = false) {
        const owner = plain(payload.id) || (plain(payload.call_id) ? payload.type + ':' + payload.call_id : hash(JSON.stringify(payload)));
        if (payload.type === 'message' && Array.isArray(payload.content)) {
            const kinds = record(payload.internal_chat_message_metadata_passthrough).content_item_kinds;
            payload.content.forEach((value, i) => {
                const block = record(value), text = textBlocks([block]).join('\n');
                if (!text)
                    return;
                const kind = Array.isArray(kinds) && typeof kinds[i] === 'string' ? kinds[i] : '';
                let category = instructionCategory(kind, payload.role);
                let prefixKey = ['host_skills.instructions', 'agents_md.instructions'].includes(kind) ? kind : owner + ':' + i;
                if (!category && text.startsWith('# AGENTS.md instructions for ')) {
                    category = 'memoryFiles';
                    prefixKey = 'agents_md.instructions';
                }
                if (!category && text.startsWith('<environment_context>')) {
                    category = 'systemPrompt';
                    prefixKey = 'environments.environment_context';
                }
                if (category) {
                    const version = owner + ':' + i + ':' + hash(text);
                    if (!restore && this.seen.has(version))
                        return;
                    this.seen.add(version);
                    this.prefix(prefixKey, text, category, at);
                }
                else if (['user', 'assistant', 'tool'].includes(payload.role)) {
                    this.put(owner + ':' + i, { text, category: 'messages', at, owner,
                        kind: payload.role === 'tool' ? 'toolResult' : payload.role }, restore);
                }
            });
            return;
        }
        let text = [];
        if (['function_call', 'custom_tool_call'].includes(payload.type))
            text = [plain(payload.name), plain(payload.arguments ?? payload.input)].filter(Boolean);
        else if (['function_call_output', 'custom_tool_call_output'].includes(payload.type))
            text = textBlocks(payload.output);
        else if (payload.type === 'reasoning')
            text = textBlocks(payload.summary);
        if (text.length)
            this.put(owner, { text: text.join('\n'), category: 'messages', at, owner,
                kind: payload.type === 'reasoning' ? 'thinking' : payload.type.endsWith('_output') ? 'toolResult' : 'toolCall' }, restore);
    }
    codex(entry, at, ownTurn) {
        const p = record(entry.payload);
        if (p.thread_id && p.thread_id !== this.info.id)
            return;
        if (entry.type === 'session_meta') {
            if (p.id && p.id !== this.info.id)
                return;
            const start = Date.parse(p.timestamp ?? entry.timestamp);
            this.ownStart = Number.isFinite(start) ? start : null;
            this.prefix('session_meta.base_instructions', plain(record(p.base_instructions).text), 'systemPrompt', at);
            return;
        }
        if (this.info.parentId && (!ownTurn || this.ownStart !== null && Date.parse(at) < this.ownStart))
            return;
        if (entry.type === 'world_state') {
            const state = record(p.state);
            if (p.full === true) {
                this.prefix('agents_md.instructions', '', 'memoryFiles', at);
                this.prefix('host_skills.instructions', '', 'skills', at);
            }
            if (Object.hasOwn(state, 'agents_md'))
                this.prefix('agents_md.instructions', plain(record(state.agents_md).text), 'memoryFiles', at);
            if (Object.hasOwn(state, 'host_skills')) {
                const skills = record(state.host_skills);
                this.prefix('host_skills.instructions', skills.includeInstructions === false ? '' : plain(skills.body), 'skills', at);
            }
        }
        if (entry.type === 'response_item')
            this.codexItem(p, at);
        if (entry.type === 'compacted' || entry.type === 'event_msg' && ['context_compacted', 'compaction_completed'].includes(p.type)) {
            this.reset();
            if (Array.isArray(p.replacement_history))
                for (const item of p.replacement_history)
                    this.codexItem(record(item), at, true);
            if (plain(p.message) && ![...this.parts.values()].some(part => part.text === p.message))
                this.put('compaction:' + hash(p.message), { text: p.message, category: 'messages', at, kind: 'summary' }, true);
        }
    }
    claude(entry, at) {
        if (entry.type === 'attachment') {
            const attachment = record(entry.attachment), content = record(attachment.content);
            const text = attachment.type === 'file' && content.type === 'text' ? plain(record(content.file).content)
                : attachment.type === 'plan_file_reference' ? plain(attachment.planContent) : '';
            if (text) {
                const id = plain(entry.uuid) || hash(attachment.type + ':' + text);
                this.put('claude:attachment:' + id, { text, category: 'messages', at,
                    kind: attachment.type === 'file' ? 'file' : 'plan' }, false, id);
            }
            return;
        }
        if (!['user', 'assistant'].includes(entry.type))
            return;
        const message = record(entry.message);
        const eventId = plain(entry.uuid), owner = entry.type === 'assistant' ? plain(message.id) : eventId;
        if (entry.type === 'user' && typeof message.content === 'string'
            && /^\s*<(?:local-command-(?:stdout|caveat)|command-name)>/.test(message.content))
            return;
        const content = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content;
        if (!Array.isArray(content))
            return;
        content.forEach((block, i) => {
            const text = textBlocks([block]).join('\n');
            if (!text)
                return;
            const slot = Number.isSafeInteger(entry.apiBlockIndex) && entry.apiBlockIndex >= 0 ? String(entry.apiBlockIndex + i) : i + ':' + hash(text);
            const key = 'claude:' + (owner || eventId || hash(text)) + ':' + slot;
            const kind = block.type === 'tool_use' ? 'toolCall' : block.type === 'tool_result' ? 'toolResult'
                : block.type === 'thinking' ? 'thinking' : entry.isCompactSummary === true ? 'summary'
                    : entry.type === 'assistant' ? 'assistant' : 'user';
            this.put(key, { text, category: 'messages', at, kind, owner: entry.type === 'assistant' ? owner : undefined }, false, eventId);
        });
    }
    publish(categories) {
        const parts = this.checkpoint?.parts ?? [...this.prefixes.values()];
        const sums = new Map();
        const messages = new Map();
        for (const part of parts) {
            const value = this.estimate(part.text, `${this.info.client === 'codex' ? 'Codex' : 'Claude'} current prompt window.${part.category} (observed text)`, this.checkpoint?.at ?? part.at);
            if (!value)
                continue;
            const previous = sums.get(part.category);
            sums.set(part.category, { ...value, tokens: (previous?.tokens ?? 0) + (value.tokens ?? 0) });
            if (part.category === 'messages') {
                const id = part.kind ?? 'other', old = messages.get(id);
                messages.set(id, { ...value, id, tokens: (old?.tokens ?? 0) + (value.tokens ?? 0) });
            }
        }
        for (const [category, value] of sums)
            categories[category] = value;
        return [...messages.values()].filter(value => (value.tokens ?? 0) > 0);
    }
}
//# sourceMappingURL=prompt-window.js.map