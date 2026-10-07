export const CATEGORIES = [
    ['mcpTools', 'MCP tools', '#287be3'], ['systemTools', 'System tools', '#ef6834'],
    ['skills', 'Skills', '#11ae79'], ['systemPrompt', 'System prompt', '#e4a000'],
    ['memoryFiles', 'Memory files', '#83817b'], ['mcpInstructions', 'MCP server instructions', '#987caf'],
    ['messages', 'Conversation', '#00a0ad'], ['unclassified', 'Unclassified', '#64748b'],
    ['buffer', 'Autocompact buffer', '#c1bfb2'], ['free', 'Free space', '#e7e7e7'],
];
export const tokenNumber = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
export function buildContext(args) {
    const view = args.view ?? 'budget';
    const modelTokens = tokenNumber(args.capacity);
    const budget = { ...args.budget };
    if (budget.tokens !== null && modelTokens && budget.tokens > modelTokens)
        budget.tokens = modelTokens;
    if (budget.disabled) {
        budget.tokens = modelTokens;
        budget.scope = 'total';
    }
    const denominator = view === 'model' ? modelTokens : budget.tokens;
    let usedTokens = tokenNumber(args.used);
    const warnings = [];
    const categories = { ...args.categories };
    if (view === 'budget' && budget.scope === 'body_after_prefix') {
        // Full-context categories cannot be attributed to the body without a boundary map.
        for (const key of Object.keys(categories))
            delete categories[key];
        if (tokenNumber(budget.prefixTokens) === null) {
            usedTokens = null;
            warnings.push('body_after_prefix: compaction prefix is unavailable');
        }
        else {
            usedTokens = usedTokens === null ? null : Math.max(0, usedTokens - budget.prefixTokens);
            warnings.push('Body view: category boundaries are unavailable');
        }
    }
    const known = Object.values(categories).reduce((sum, m) => sum + (tokenNumber(m?.tokens) ?? 0), 0);
    if (usedTokens !== null) {
        if (known > usedTokens)
            warnings.push(`Category conflict: ${known} > context ${usedTokens}; values are not rescaled`);
        categories.unclassified = { tokens: Math.max(0, usedTokens - known), accuracy: 'derived', source: 'Reported total minus known categories' };
    }
    let buffer = args.buffer;
    if (!buffer && modelTokens && budget.tokens !== null && budget.scope === 'total' && !budget.disabled && ['reported', 'configured'].includes(budget.accuracy)) {
        buffer = { tokens: Math.max(0, modelTokens - budget.tokens), accuracy: 'derived', source: 'Model window minus configured compaction budget (outside budget)', placement: 'outside' };
    }
    if (budget.disabled)
        buffer = { tokens: 0, accuracy: 'configured', source: 'Auto-compaction disabled', placement: 'inside' };
    const reserved = buffer && (view === 'model' || buffer.placement === 'inside') ? buffer.tokens : buffer ? 0 : null;
    categories.buffer = buffer
        ? { ...buffer, tokens: reserved, source: `${buffer.source}${view === 'budget' && buffer.placement === 'outside' ? '; excluded from budget view' : ''}` }
        : { tokens: null, accuracy: 'unknown', source: 'Compaction reserve not reported' };
    categories.free = {
        tokens: usedTokens === null || !denominator || reserved === null ? null : Math.max(0, denominator - usedTokens - reserved),
        accuracy: 'derived', source: 'Denominator minus context and reserve; unknown when reserve is unknown',
    };
    if (usedTokens !== null && denominator && usedTokens > denominator)
        warnings.push('Context exceeds the selected budget');
    const segments = CATEGORIES.map(([id, label, color]) => {
        const m = categories[id] ?? { tokens: null, accuracy: 'unknown', source: 'Not reported by this client' };
        const tokens = tokenNumber(m.tokens);
        return { ...m, tokens, id, label, color, percent: tokens !== null && denominator ? tokens / denominator * 100 : null };
    });
    return { usedTokens, modelTokens, budget, denominator, view, segments, warnings,
        percent: usedTokens !== null && denominator ? usedTokens / denominator * 100 : null, updatedAt: args.at ?? null };
}
//# sourceMappingURL=context.js.map