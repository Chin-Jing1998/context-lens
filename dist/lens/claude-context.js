import { record } from './settings.js';
const names = (value) => Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
/** Observed prompt state only. Never reads installed inventories or saves prompt content. */
export class ClaudeContext {
    estimate;
    inlineTools = new Map();
    deferredTools = new Map();
    instructions = new Map();
    signatures = new Map();
    history = new Map();
    constructor(estimate) {
        this.estimate = estimate;
    }
    reset(categories, preserved = []) {
        const keep = new Set(preserved);
        const records = [...this.history].filter(([id]) => keep.has(id));
        this.inlineTools.clear();
        this.deferredTools.clear();
        this.instructions.clear();
        this.signatures.clear();
        this.history.clear();
        for (const key of Object.keys(categories))
            delete categories[key];
        for (const [id, saved] of records)
            this.apply(saved.data, saved.at, categories, id);
    }
    publish(id, text, source, at, categories) {
        if (this.signatures.get(id) === text)
            return;
        this.signatures.set(id, text);
        const value = text ? this.estimate(text, source, at) : { tokens: 0, accuracy: 'estimated', source, at };
        if (value)
            categories[id] = value;
        else
            delete categories[id];
    }
    toolMap(tools) {
        const result = new Map();
        for (const item of tools) {
            const t = record(item);
            // Desktop snapshots wrap the complete wire definition in `schema`.
            const wire = record(t.schema);
            const wrapped = Object.hasOwn(wire, 'input_schema');
            const schema = t.input_schema ?? (wrapped ? wire.input_schema : t.schema);
            if (typeof t.name !== 'string' || !t.name || !schema || typeof schema !== 'object' || Array.isArray(schema))
                continue;
            if (wrapped && wire.name && wire.name !== t.name)
                continue;
            const description = wrapped && typeof wire.description === 'string' ? wire.description : typeof t.description === 'string' ? t.description : '';
            result.set(t.name, JSON.stringify({ name: t.name, description, input_schema: schema }));
        }
        return result;
    }
    publishTools(at, categories) {
        const tools = [...new Map([...this.deferredTools, ...this.inlineTools])].sort(([a], [b]) => a.localeCompare(b));
        for (const [id, mcp] of [['mcpTools', true], ['systemTools', false]]) {
            const text = tools.filter(([name]) => name.startsWith('mcp__') === mcp).map(([, body]) => body).join('\n');
            this.publish(id, text, 'Claude prompt_snapshot.tools / deferred_tools_record (observed definitions)', at, categories);
        }
    }
    apply(data, at, categories, id) {
        if (id && this.history.has(id))
            return;
        switch (data.type) {
            case 'prompt_snapshot':
                if (Array.isArray(data.systemPrompt) && data.systemPrompt.every((v) => typeof v === 'string'))
                    this.publish('systemPrompt', [...(typeof data.cliPrefix === 'string' && data.cliPrefix ? [data.cliPrefix] : []), ...data.systemPrompt].join('\n'), 'Claude prompt_snapshot.systemPrompt / cliPrefix', at, categories);
                // Missing tools means no new observation; an explicit [] replaces the snapshot.
                if (Array.isArray(data.tools)) {
                    this.inlineTools = this.toolMap(data.tools);
                    this.publishTools(at, categories);
                }
                break;
            case 'deferred_tools_record':
                if (Array.isArray(data.entries)) {
                    for (const [name, body] of this.toolMap(data.entries))
                        this.deferredTools.set(name, body);
                    this.publishTools(at, categories);
                }
                break;
            case 'deferred_tools_delta': {
                let changed = false;
                for (const name of [...names(data.removedNames), ...names(data.wireHiddenNames)]) {
                    changed = this.inlineTools.delete(name) || changed;
                    changed = this.deferredTools.delete(name) || changed;
                }
                if (changed)
                    this.publishTools(at, categories);
                // Tool names/descriptions in an availability list are not loaded schemas.
                break;
            }
            case 'instructions':
                if (Array.isArray(data.files)) {
                    const files = new Map();
                    for (const value of data.files) {
                        const file = record(value);
                        if (typeof file.path === 'string' && typeof file.content === 'string')
                            files.set(file.path, file.content);
                    }
                    this.publish('memoryFiles', [...files].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n'), 'Claude instructions.files (loaded)', at, categories);
                }
                break;
            case 'skill_listing':
                if (typeof data.content === 'string')
                    this.publish('skills', data.content, 'Claude skill_listing.content (injected listing)', at, categories);
                break;
            case 'mcp_instructions_delta': {
                const added = Array.isArray(data.addedNames) ? data.addedNames : [], blocks = data.addedBlocks;
                for (const name of names(data.removedNames))
                    this.instructions.delete(name);
                if (Array.isArray(blocks))
                    added.forEach((name, i) => { if (typeof name === 'string' && typeof blocks[i] === 'string')
                        this.instructions.set(name, blocks[i]); });
                this.publish('mcpInstructions', [...this.instructions].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n'), 'Claude mcp_instructions_delta (loaded)', at, categories);
                break;
            }
            default: return;
        }
        if (id)
            this.history.set(id, { data, at });
    }
}
//# sourceMappingURL=claude-context.js.map