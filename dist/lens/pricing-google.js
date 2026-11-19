const labels = [
    ['Input price', 'input'], ['Output price (including thinking tokens)', 'output'], ['Context caching price', 'cacheRead'],
];
function readTier(tab) {
    const table = tab.match(/\{% table %\}([\s\S]*?)\{% \/table %\}/)?.[1];
    const rows = table?.split(/^\s*---[ \t]*$/m).map(row => row.trim().split(/\n\s*\* /).map(cell => cell.trim().replace(/^\* /, '')));
    if (rows?.[0]?.join('|') !== 'Feature|Free Tier|Paid Tier, per 1M tokens in USD')
        throw new Error('Gemini USD 价格表列已变化');
    const rates = {}, later = {};
    let effectiveAt = '';
    for (const [label, field] of labels) {
        const row = rows.find(row => row[0] === label);
        if (row?.length !== 3)
            throw new Error('Gemini token 价格行已变化');
        // 只读取按 token 计价的缓存读取行，存储按时长单独计价。
        const value = field === 'cacheRead' ? row[2].split(/\n\s*(?=Implicit caching only|\$[\d.]+ \/ 1,000,000 tokens per hour \(storage price\))/)[0] : row[2];
        const amount = value.replace(/\s+/g, ' ').trim();
        const match = amount.match(/^\$(\d+(?:\.\d+)?)(?: through ([A-Za-z]+ \d{1,2}, \d{4})\. \$(\d+(?:\.\d+)?) starting ([A-Za-z]+ \d{1,2}, \d{4})\.)?$/);
        if (!match)
            throw new Error('Gemini token 单价格式已变化');
        rates[field] = Number(match[1]);
        if (match[3] !== undefined) {
            // 官网仅给出日历日期，按 UTC 的日界线应用。
            const start = Date.parse(match[4] + ' UTC'), end = Date.parse(match[2] + ' UTC');
            if (!Number.isFinite(start) || start - end !== 86_400_000)
                throw new Error('Gemini 单价切换日期无效');
            const date = new Date(start).toISOString();
            if (effectiveAt && date !== effectiveAt)
                throw new Error('Gemini token 分项的切换日期不一致');
            effectiveAt = date;
        }
        later[field] = match[3] === undefined ? rates[field] : Number(match[3]);
    }
    return { rates, ...(effectiveAt ? { dateChange: { at: effectiveAt, rates: later } } : {}) };
}
/** 读取 Gemini 文本模型的美元付费层，用量覆盖输入、输出及缓存读取。 */
export function parseGooglePrices(document) {
    const models = Object.create(null);
    const headings = /^## Gemini (?:4 [A-Za-z]+|3\.[68] Flash)\s+\{% id="(gemini-(?:4-[a-z]+|3\.[68]-flash))" %\}[ \t]*$([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
    for (const [, model, body] of document.matchAll(headings)) {
        const tiers = Object.create(null);
        for (const [, name, tab] of body.matchAll(/\{% tab title="(Standard|Batch|Flex|Priority)" %\}([\s\S]*?)\{% \/tab %\}/g)) {
            tiers[name.toLowerCase()] = readTier(tab);
        }
        const { standard, ...other } = tiers;
        if (!standard || models[model])
            throw new Error('Gemini 标准价格缺失或重复');
        models[model] = { ...standard, tiers: other };
    }
    if (!models['gemini-4-argon'] || Object.keys(models).length < 4)
        throw new Error('Gemini 官方价格表不完整');
    return models;
}
//# sourceMappingURL=pricing-google.js.map