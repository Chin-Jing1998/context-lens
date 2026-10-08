import path from 'node:path';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { record } from './settings.js';
const clean = (value, max = 160) => typeof value === 'string' ? sanitizeDisplayText(value).trim().slice(0, max) : '';
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
function object(value) {
    if (typeof value === 'string') {
        try {
            return record(JSON.parse(value));
        }
        catch {
            return {};
        }
    }
    return record(value);
}
function failed(value, depth = 0) {
    if (depth > 4)
        return false;
    const v = object(value);
    if (v.isError === true || v.is_error === true || v.ok === false || v.status === 'failed')
        return true;
    if (v.structuredContent && failed(v.structuredContent, depth + 1))
        return true;
    // Hub results can carry their business error in a JSON text block.
    return Array.isArray(v.content) && v.content.some((block) => failed(record(block).text, depth + 1));
}
function duration(value) {
    const v = record(value), secs = finite(v.secs), nanos = finite(v.nanos);
    return secs === null ? null : secs * 1000 + (nanos ?? 0) / 1e6;
}
function skillName(value, cwd) {
    let file = clean(value, 4096).replaceAll('\\', '/');
    if (file === 'SKILL.md' && cwd)
        file = cwd.replaceAll('\\', '/') + '/' + file;
    return /\/SKILL\.md$/i.test(file) ? clean(path.posix.basename(path.posix.dirname(file))) : '';
}
function commandName(value) {
    const command = Array.isArray(value) ? value.map(String) : [clean(value, 4096)];
    const source = command.length > 2 && /^-.*c$/.test(command[1]) ? command[2] : command.join(' ');
    const match = /^\s*(?:[A-Za-z_][\w]*=(?:'[^']*'|"[^"]*"|[^\s]+)\s+)*(?:([\w./~-]+)|'([^']+)'|"([^"]+)")/.exec(source);
    const executable = match && path.posix.basename(match[1] || match[2] || match[3]);
    return executable && !['for', 'if', 'while', 'function', 'do', 'case'].includes(executable) ? clean(executable) : 'shell';
}
function mcpTarget(server, tool, args) {
    const input = object(args);
    return server === 'hub' && tool === 'call_tool' && clean(input.server) && clean(input.tool)
        ? { name: clean(input.server), detail: clean(input.tool) }
        : { name: clean(server) || 'MCP', detail: clean(tool) };
}
/** Count execution records, never JavaScript source text or installed tool inventories. */
export class ActivityReader {
    info;
    calls = new Map();
    nativeIds = new Set();
    processes = new Map();
    continuations = new Map();
    asynchronous = new Set();
    reads = new Map();
    native = false;
    wrappers = false;
    constructor(info) {
        this.info = info;
    }
    key(id) { return this.info.client + ':' + id; }
    add(id, kind, name, detail, action, at) {
        const key = this.key(id), old = this.calls.get(key);
        if (old)
            return old;
        const call = { id: key, kind, name, detail, action, at, status: 'running', durationMs: null, exitCode: null };
        this.calls.set(key, call);
        return call;
    }
    finishReads(id, call) {
        if (call.status !== 'succeeded')
            return;
        for (const name of this.reads.get(id) ?? []) {
            const read = this.add(id + ':skill:' + name, 'skills', name, 'SKILL.md', 'read', call.at);
            read.status = 'succeeded';
        }
    }
    result(id, value, at) {
        const target = this.continuations.get(id) ?? id, call = this.calls.get(this.key(target));
        if (!call || this.nativeIds.has(target))
            return;
        const v = object(value);
        const blocks = Array.isArray(value) ? value : Array.isArray(v.content) ? v.content : [];
        const output = typeof value === 'string' ? value : blocks.map(b => clean(record(b).text, 32000)).join('\n');
        const exitMatch = /(?:Process exited with code|exit_code["']?\s*:)\s*(-?\d+)/.exec(output);
        const exit = typeof v.exit_code === 'number' ? v.exit_code : exitMatch ? Number(exitMatch[1]) : null;
        const process = v.session_id ?? v.process_id ?? /Process running with session ID (\d+)/.exec(output)?.[1];
        if (call.kind === 'commands') {
            if (process !== undefined && exit === null) {
                this.processes.set(String(process), target);
                this.asynchronous.add(target);
                call.status = 'running';
                call.durationMs = null;
                return;
            }
            call.exitCode = exit;
            call.status = failed(value) || exit !== null && exit !== 0 ? 'failed' : exit === 0 ? 'succeeded' : 'unknown';
            // A poll's wait time is not the process's total runtime.
            call.durationMs = this.asynchronous.has(target) || finite(v.wall_time_seconds) === null ? null : v.wall_time_seconds * 1000;
        }
        else
            call.status = failed(value) || blocks.some(b => failed(record(b).text)) ? 'failed' : 'succeeded';
        this.finishReads(target, call);
    }
    tool(id, name, input, at) {
        if (!id)
            return;
        const args = object(input), short = name.replace(/^functions\./, '');
        let call;
        if (['exec_command', 'shell_command', 'shell', 'Bash'].includes(short)) {
            call = this.add(id, 'commands', commandName(args.cmd ?? args.command), '', 'run', at);
        }
        else if (short === 'write_stdin') {
            const original = this.processes.get(String(args.session_id));
            if (original)
                this.continuations.set(id, original);
        }
        else if (['Skill', 'skill'].includes(short) && clean(args.skill ?? args.name)) {
            call = this.add(id, 'skills', clean(args.skill ?? args.name), '', 'invoke', at);
        }
        else if (['Read', 'read_file'].includes(short) && skillName(args.file_path ?? args.path)) {
            call = this.add(id, 'skills', skillName(args.file_path ?? args.path), 'SKILL.md', 'read', at);
        }
        else {
            const match = /^(?:functions\.)?mcp__(.+?)__(.+)$/.exec(name);
            if (match) {
                const target = mcpTarget(match[1], match[2], args);
                call = this.add(id, 'mcp', target.name, target.detail, 'invoke', at);
            }
        }
    }
    accept(entry, ownTurn) {
        const at = instant(entry.timestamp);
        if (this.info.client === 'claude') {
            if (entry.isApiErrorMessage === true || entry.error || record(entry.message).model === '<synthetic>')
                return;
            const content = record(entry.message).content;
            if (!Array.isArray(content))
                return;
            for (const raw of content) {
                const block = record(raw);
                if (entry.type === 'assistant' && block.type === 'tool_use')
                    this.tool(clean(block.id, 240), clean(block.name), block.input, at);
                if (entry.type === 'user' && block.type === 'tool_result') {
                    const content = block.content;
                    // Claude's structured command result supplies exit status where available.
                    const result = record(entry.toolUseResult), exitCode = result.exitCode ?? result.exit_code;
                    this.result(clean(block.tool_use_id, 240), { content: Array.isArray(content) ? content : [{ text: content }], is_error: block.is_error,
                        ...(typeof exitCode === 'number' ? { exit_code: exitCode } : {}) }, at);
                    const call = this.calls.get(this.key(clean(block.tool_use_id, 240)));
                    if (call?.kind === 'commands' && call.status === 'unknown')
                        call.status = block.is_error ? 'failed' : 'succeeded';
                }
            }
            return;
        }
        const payload = record(entry.payload);
        if (payload.thread_id && payload.thread_id !== this.info.id)
            return;
        const item = record(payload.item), id = clean(item.id, 240);
        if (entry.type === 'event_msg' && ['item_started', 'item_completed'].includes(payload.type) && id && (ownTurn || payload.thread_id === this.info.id)) {
            if (item.type === 'CommandExecution') {
                this.native = true;
                const previous = item.source === 'unified_exec_interaction' ? this.processes.get(String(item.process_id)) : undefined;
                const callId = previous ?? id;
                this.nativeIds.add(callId);
                const call = this.add(callId, 'commands', commandName(item.command), '', 'run', at);
                if (item.process_id !== undefined)
                    this.processes.set(String(item.process_id), callId);
                const parsed = Array.isArray(item.parsed_cmd) ? item.parsed_cmd : [];
                this.reads.set(callId, [...new Set(parsed.filter(p => record(p).type === 'read').map(p => skillName(record(p).path, clean(item.cwd, 4096))).filter(Boolean))]);
                call.exitCode = typeof item.exit_code === 'number' ? item.exit_code : null;
                call.status = ['failed', 'declined', 'cancelled', 'canceled', 'interrupted'].includes(item.status) || call.exitCode !== null && call.exitCode !== 0 ? 'failed'
                    : call.exitCode === 0 ? 'succeeded' : ['inProgress', 'in_progress', 'running'].includes(item.status) || payload.type === 'item_started' ? 'running' : 'unknown';
                call.durationMs = duration(item.duration);
                this.finishReads(callId, call);
            }
            else if (item.type === 'McpToolCall') {
                this.native = true;
                this.nativeIds.add(id);
                const target = mcpTarget(item.server, item.tool, item.arguments);
                const call = this.add(id, 'mcp', target.name, target.detail, 'invoke', at);
                call.status = ['failed', 'cancelled', 'canceled', 'interrupted'].includes(item.status) || failed(item.result) || item.error ? 'failed' : item.status === 'completed' ? 'succeeded' : 'running';
                call.durationMs = duration(item.duration);
            }
        }
        if (entry.type !== 'response_item' || !ownTurn)
            return;
        if (payload.type === 'function_call') {
            const name = clean(payload.name), namespace = clean(payload.namespace);
            this.tool(clean(payload.call_id, 240), namespace && !name.startsWith(namespace) ? namespace + (namespace === 'functions' ? '.' : '__') + name : name, payload.arguments, at);
        }
        else if (payload.type === 'custom_tool_call' && ['exec', 'functions.exec'].includes(payload.name))
            this.wrappers = true;
        else if (['function_call_output', 'custom_tool_call_output'].includes(payload.type))
            this.result(clean(payload.call_id, 240), payload.output, at);
    }
    finish(complete) {
        return { calls: [...this.calls.values()], complete: complete && !(this.wrappers && !this.native) };
    }
}
function counts(calls) {
    const measured = calls.filter(c => c.durationMs !== null);
    return { total: calls.length, succeeded: calls.filter(c => c.status === 'succeeded').length,
        failed: calls.filter(c => c.status === 'failed').length, running: calls.filter(c => c.status === 'running').length,
        unknown: calls.filter(c => c.status === 'unknown').length,
        durationMs: measured.length ? measured.reduce((sum, c) => sum + c.durationMs, 0) : calls.length ? null : 0,
        durationComplete: measured.length === calls.length };
}
export function summarizeActivity(main, agents = []) {
    const unique = new Map();
    for (const [index, log] of [main, ...agents].entries())
        for (const call of log.calls) {
            if (!unique.has(call.id))
                unique.set(call.id, { ...call, scope: index ? 'agent' : 'main' });
        }
    const summarize = (kind) => {
        const calls = [...unique.values()].filter(c => c.kind === kind), groups = new Map();
        for (const call of calls) {
            const key = JSON.stringify([call.name, call.detail, call.action]);
            const group = groups.get(key);
            if (group)
                group.push(call);
            else
                groups.set(key, [call]);
        }
        return { ...counts(calls), main: calls.filter(c => c.scope === 'main').length, agents: calls.filter(c => c.scope === 'agent').length,
            invoked: calls.filter(c => c.action === 'invoke').length, reads: calls.filter(c => c.action === 'read').length,
            groups: [...groups.values()].map(rows => ({ name: rows[0].name, detail: rows[0].detail, action: rows[0].action, ...counts(rows) }))
                .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
            recent: calls.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, 60) };
    };
    return { complete: [main, ...agents].every(s => s.complete), commands: summarize('commands'), skills: summarize('skills'), mcp: summarize('mcp') };
}
//# sourceMappingURL=activity.js.map