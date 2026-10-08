import { createHash } from 'node:crypto';
import { sanitizeDisplayText } from '../utils/sanitize.js';
import { record } from './settings.js';
const clean = (value, max = 240) => typeof value === 'string' ? sanitizeDisplayText(value).trim().slice(0, max) : '';
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const taskState = (value) => value === 'running' ? 'in_progress'
    : ['pending', 'in_progress', 'completed', 'failed'].includes(String(value)) ? value : 'unknown';
function patchCounts(value) {
    const unknown = { addedLines: null, removedLines: null };
    if (!Array.isArray(value) || !value.length)
        return unknown;
    let addedLines = 0, removedLines = 0;
    for (const raw of value) {
        const lines = record(raw).lines;
        if (!Array.isArray(lines) || lines.some(line => typeof line !== 'string' || !['+', '-', ' ', '\\'].includes(line[0])))
            return unknown;
        for (const line of lines) {
            if (line.startsWith('+'))
                addedLines++;
            if (line.startsWith('-'))
                removedLines++;
        }
    }
    return { addedLines, removedLines };
}
/** Reads observed execution metadata. Prompt bodies, commands and tool output are never returned. */
export class ClaudeDetailsReader {
    complete = true;
    compactions = new Map();
    hooks = new Map();
    stops = new Map();
    files = new Map();
    tasks = new Map();
    agents = new Map();
    taskInputs = new Map();
    results = new Set();
    metadata = {};
    eventId(entry, value) {
        const id = clean(entry.uuid);
        if (!id && !instant(entry.timestamp))
            this.complete = false;
        return id || digest([entry.timestamp ?? null, value]);
    }
    accept(entry) {
        const at = instant(entry.timestamp);
        for (const key of ['version', 'gitBranch', 'permissionMode']) {
            const value = clean(entry[key]), old = this.metadata[key];
            if (value && (!old?.at || at && at >= old.at))
                this.metadata[key] = { value, at };
        }
        if (entry.type === 'system' && entry.subtype === 'compact_boundary') {
            const m = record(entry.compactMetadata), preserved = record(m.preservedMessages);
            const ids = Array.isArray(preserved.allUuids) ? preserved.allUuids : Array.isArray(preserved.uuids) ? preserved.uuids : null;
            const beforeTokens = count(m.preTokens), afterTokens = count(m.postTokens), id = this.eventId(entry, m);
            this.compactions.set(id, { id, at, trigger: clean(m.trigger) || null, beforeTokens, afterTokens,
                releasedTokens: beforeTokens === null || afterTokens === null ? null : beforeTokens - afterTokens,
                cumulativeDroppedTokens: count(m.cumulativeDroppedTokens), durationMs: number(m.durationMs),
                retainedMessages: ids ? new Set(ids.filter(value => typeof value === 'string')).size : null });
        }
        if (entry.type === 'system' && entry.subtype === 'stop_hook_summary') {
            const id = this.eventId(entry, [entry.subtype, entry.toolUseID, entry.hookCount, entry.preventedContinuation]);
            this.stops.set(id, { id, at, hookCount: count(entry.hookCount),
                errorCount: Array.isArray(entry.hookErrors) ? entry.hookErrors.length : null,
                preventedContinuation: typeof entry.preventedContinuation === 'boolean' ? entry.preventedContinuation : null });
        }
        if (entry.type === 'attachment') {
            const a = record(entry.attachment);
            if (['hook_success', 'hook_non_blocking_error'].includes(a.type)) {
                const id = this.eventId(entry, a), exitCode = Number.isSafeInteger(a.exitCode) ? a.exitCode : null;
                this.hooks.set(id, { id, at, name: clean(a.hookName), event: clean(a.hookEvent), toolUseId: clean(a.toolUseID) || null,
                    status: a.type === 'hook_non_blocking_error' || exitCode !== null && exitCode !== 0 ? 'failed'
                        : a.type === 'hook_success' ? 'succeeded' : 'unknown', exitCode, durationMs: number(a.durationMs) });
            }
            if (a.type === 'task_status' && clean(a.taskId)) {
                const id = clean(a.taskId), status = taskState(a.status);
                if (a.taskType === 'local_agent') {
                    const agent = [...this.agents.values()].find(value => value.agentId === id);
                    if (agent && (!agent.endedAt || at && at >= agent.endedAt)) {
                        agent.status = status === 'completed' ? 'succeeded' : status === 'failed' ? 'failed' : status === 'in_progress' ? 'running' : 'unknown';
                        if (['succeeded', 'failed'].includes(agent.status))
                            agent.endedAt = at;
                    }
                }
                else
                    this.tasks.set(id, { id, title: clean(a.description), status, at, source: 'task_status' });
            }
        }
        if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && typeof entry.content === 'string') {
            const id = /<tool-use-id>([^<]+)<\/tool-use-id>/.exec(entry.content)?.[1];
            const status = /<status>(completed|failed)<\/status>/.exec(entry.content)?.[1];
            const agent = id ? this.agents.get(id) : undefined;
            if (agent && status) {
                agent.status = status === 'completed' ? 'succeeded' : 'failed';
                agent.endedAt = at;
            }
        }
        const message = record(entry.message);
        if (entry.isApiErrorMessage === true || entry.error || message.model === '<synthetic>' || !Array.isArray(message.content))
            return;
        const results = message.content.filter((b) => record(b).type === 'tool_result');
        for (const raw of message.content) {
            const block = record(raw), id = clean(block.id);
            if (entry.type === 'assistant' && block.type === 'tool_use' && id)
                this.tool(id, clean(block.name), record(block.input), at);
            if (entry.type === 'user' && block.type === 'tool_result' && clean(block.tool_use_id)) {
                // A top-level structured result belongs to one result block, never every result in a batch.
                this.result(clean(block.tool_use_id), block, results.length === 1 ? record(entry.toolUseResult) : {}, at);
            }
        }
    }
    tool(id, name, input, at) {
        if (this.results.has(id))
            return;
        const actions = { Read: 'read', Write: 'write', Edit: 'edit', MultiEdit: 'edit' };
        const action = Object.hasOwn(actions, name) ? actions[name] : undefined;
        const file = clean(input.file_path ?? input.path, 4096);
        if (action && file)
            this.files.set(id, { id, at, endedAt: null, tool: name, path: file, action,
                status: 'running', addedLines: null, removedLines: null });
        if (['Agent', 'Task'].includes(name)) {
            this.agents.set(id, { id, agentId: null, type: clean(input.subagent_type) || 'agent', description: clean(input.description) || null,
                model: clean(input.model) || null, background: input.run_in_background === true, status: 'running', at, endedAt: null });
        }
        if (['TodoWrite', 'TaskCreate', 'TaskUpdate'].includes(name))
            this.taskInputs.set(id, { name, input });
    }
    result(id, block, result, at) {
        if (this.results.has(id))
            return;
        this.results.add(id);
        const failed = block.is_error === true || result.success === false || result.status === 'failed' || result.interrupted === true;
        const file = this.files.get(id);
        if (file) {
            file.status = failed ? 'failed' : 'succeeded';
            file.endedAt = at;
            if (!failed && file.action !== 'read') {
                Object.assign(file, patchCounts(result.structuredPatch));
                if (file.addedLines === null && result.type === 'create' && typeof result.content === 'string') {
                    file.addedLines = result.content ? result.content.split('\n').length - (result.content.endsWith('\n') ? 1 : 0) : 0;
                    file.removedLines = 0;
                }
            }
        }
        const agent = this.agents.get(id);
        if (agent) {
            agent.agentId = clean(result.agentId) || agent.agentId;
            agent.model = clean(result.resolvedModel) || agent.model;
            agent.background ||= result.isAsync === true || result.status === 'async_launched';
            agent.status = failed ? 'failed' : agent.background ? 'running' : 'succeeded';
            if (agent.status !== 'running')
                agent.endedAt = at;
        }
        const pending = this.taskInputs.get(id);
        if (!pending || failed)
            return;
        const { name, input } = pending;
        if (name === 'TodoWrite' && Array.isArray(input.todos)) {
            this.tasks.clear();
            input.todos.forEach((raw, index) => {
                const item = record(raw), title = clean(item.content);
                if (title) {
                    const key = `${id}:${index}`;
                    this.tasks.set(key, { id: key, title, status: taskState(item.status), at, source: name });
                }
            });
        }
        else if (name === 'TaskCreate') {
            const task = record(result.task), taskId = clean(String(task.id ?? result.taskId ?? input.taskId ?? id));
            const title = clean(task.subject ?? input.subject ?? input.description);
            if (title)
                this.tasks.set(taskId, { id: taskId, title, status: taskState(task.status ?? input.status), at, source: name });
        }
        else if (name === 'TaskUpdate') {
            const taskId = clean(String(input.taskId ?? '')), task = this.tasks.get(taskId);
            if (input.status === 'deleted')
                this.tasks.delete(taskId);
            else if (task) {
                if (input.status !== undefined)
                    task.status = taskState(input.status);
                task.title = clean(input.subject) || task.title;
                task.at = at;
                task.source = name;
            }
            else
                this.complete = false;
        }
    }
    finish() {
        return { complete: this.complete, compactions: [...this.compactions.values()], hooks: [...this.hooks.values()], hookStops: [...this.stops.values()],
            files: [...this.files.values()], tasks: [...this.tasks.values()], agents: [...this.agents.values()], metadata: this.metadata };
    }
}
export function summarizeDetails(details) {
    const { compactions, hooks, hookStops, files, tasks, agents } = details;
    const measured = hooks.filter(value => value.durationMs !== null);
    return { scope: 'main', complete: details.complete,
        ...(compactions.length ? { compactions: { count: compactions.length, latest: compactions.at(-1) } } : {}),
        ...(hooks.length || hookStops.length ? { hooks: { total: hooks.length, failed: hooks.filter(value => value.status === 'failed').length,
                durationMs: measured.length ? measured.reduce((sum, value) => sum + value.durationMs, 0) : null,
                durationComplete: measured.length === hooks.length, blockedStops: hookStops.filter(value => value.preventedContinuation === true).length } } : {}),
        ...(files.length ? { files: { operations: files.length, uniquePaths: new Set(files.map(value => value.path)).size,
                reads: files.filter(value => value.action === 'read').length, writes: files.filter(value => value.action === 'write').length,
                edits: files.filter(value => value.action === 'edit').length, failed: files.filter(value => value.status === 'failed').length } } : {}),
        ...(tasks.length ? { tasks: { total: tasks.length, completed: tasks.filter(value => value.status === 'completed').length,
                inProgress: tasks.filter(value => value.status === 'in_progress').length, pending: tasks.filter(value => value.status === 'pending').length,
                failed: tasks.filter(value => value.status === 'failed').length } } : {}),
        ...(agents.length ? { agents: { total: agents.length, running: agents.filter(value => value.status === 'running').length,
                completed: agents.filter(value => value.status === 'succeeded').length, failed: agents.filter(value => value.status === 'failed').length } } : {}),
        ...(Object.keys(details.metadata).length ? { metadata: details.metadata } : {}), };
}
//# sourceMappingURL=claude-details.js.map