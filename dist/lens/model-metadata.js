const GEMINI_4_ARGON = {
    id: 'gemini-4-argon', capacity: 1_048_576,
    source: 'https://ai.google.dev/gemini-api/docs/models/gemini-4-argon',
    checkedAt: '2026-10-19T02:36:48Z',
};
/** Recognize only verified IDs and the explicitly supported provider/resource prefixes. */
export function officialModelMetadata(model) {
    const id = model?.toLowerCase().replace(/^(?:google\/(?:models\/)?|models\/)/, '');
    return id === GEMINI_4_ARGON.id ? GEMINI_4_ARGON : undefined;
}
/** 仅展开已知厂商命名空间、官方显示名和有日期的模型快照。 */
export function priceModelIds(model) {
    const id = model.trim().toLowerCase()
        .replace(/^(?:google\/(?:models\/)?|models\/)(?=gemini-)/, '')
        .replace(/^openai\/(?=gpt-|o[134](?:-|$))/, '')
        .replace(/^anthropic\/(?=claude-)/, '')
        .replace(/^deepseek\/(?=deepseek-)/, '')
        .replace(/^(?:z-ai|zai)\/(?=glm-)/, '')
        .replace(/^xiaomi\/(?=mimo-)/, '')
        .replace(/^gemini (\d+(?:\.\d+)*) ([a-z]+(?: [a-z]+)*)$/, (_, version, name) => 'gemini-' + version + '-' + name.replaceAll(' ', '-'))
        .replace(/^(claude-(?:opus|sonnet|haiku|fable|mythos)-\d+)\.(\d+)(?=-|$)/, '$1-$2');
    const base = id.startsWith('gemini-') ? id : id.replace(/-\d{4}-\d{2}-\d{2}$|-\d{8}$/, '');
    return [...new Set([model, id, base])];
}
//# sourceMappingURL=model-metadata.js.map