import { tokenNumber } from './context.js';
import { fields, messages, nested, string } from './agy-wire.js';
// Antigravity 的 TokenType 枚举，使用上层分组统计，避免再次加上子项。
const groupCategories = {
    1: 'systemPrompt', 2: 'systemTools', 3: 'rules', 4: 'mcpTools', 5: 'skills',
    6: 'subagents', 7: 'messages', 8: 'workflows', 9: 'plugins', 10: 'flows',
};
const messageCategories = {
    USER_INPUT: 'user', PLANNER_RESPONSE: 'assistant', CHECKPOINT: 'summary',
    EPHEMERAL_MESSAGE: 'system', SYSTEM_MESSAGE: 'system', GENERIC: 'tools',
    RUN_COMMAND: 'tools', COMMAND_STATUS: 'tools', SEND_COMMAND_INPUT: 'tools', SHELL_EXEC: 'tools',
    MCP_TOOL: 'tools', VIEW_FILE: 'tools', LIST_DIRECTORY: 'tools', LIST_RESOURCES: 'tools', READ_RESOURCE: 'tools',
};
export function agyContextBreakdown(data, used, at) {
    // ContextWindowMetadata.token_breakdown.total_tokens 必须与同一快照的占用量一致。
    if (tokenNumber(nested(data, [2]).get(2)) !== used)
        return undefined;
    const categories = {};
    const parts = new Map();
    const measurement = (tokens) => ({ tokens, accuracy: 'estimated', source: 'Antigravity 上下文快照', at });
    let total = 0;
    for (const value of messages(data, 1)) {
        const group = fields(value, [2, 4]);
        const type = tokenNumber(group.get(2)) ?? 0;
        const tokens = tokenNumber(group.get(4) ?? 0);
        if (tokens === null)
            return undefined;
        total += tokens;
        if (total > used)
            return undefined;
        const category = groupCategories[type];
        if (!category || !tokens)
            continue;
        categories[category] = measurement((categories[category]?.tokens ?? 0) + tokens);
        if (category !== 'messages')
            continue;
        for (const detail of messages(value, 5)) {
            const child = fields(detail, [1, 3]);
            const label = /^\d+: ([A-Z_]+)$/.exec(string(child.get(1)))?.[1];
            const id = label && Object.hasOwn(messageCategories, label) ? messageCategories[label] : 'other';
            const count = tokenNumber(child.get(3));
            if (count)
                parts.set(id, (parts.get(id) ?? 0) + count);
        }
    }
    const subtotal = [...parts.values()].reduce((sum, value) => sum + value, 0);
    const validDetails = subtotal > 0 && subtotal <= (categories.messages?.tokens ?? 0);
    const messageBreakdown = validDetails ? [...parts].map(([id, tokens]) => ({ ...measurement(tokens), id })) : undefined;
    return { categories, messageBreakdown };
}
//# sourceMappingURL=agy-context.js.map