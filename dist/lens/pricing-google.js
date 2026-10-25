/** Parse the bounded Gemini 4 Standard HTML table, never another model or tier. */
export function parseGooglePrices(document) {
    const sections = [...document.matchAll(/<h2\b[^>]*\bid=["']gemini-4-argon["'][^>]*>[\s\S]*?<\/h2>([\s\S]*?)(?=<h2\b|$(?![\s\S]))/gi)];
    if (sections.length !== 1)
        throw new Error('Gemini 4 official pricing section changed');
    const table = sections[0][1].match(/<h3\b[^>]*>Standard<\/h3>\s*(<table\b[^>]*>[\s\S]*?<\/table>)/i)?.[1];
    if (!table)
        throw new Error('Gemini Standard price table is missing');
    const plain = (value) => value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map(row => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plain(cell[1])));
    if (rows[0]?.join('|') !== '|Free Tier|Paid Tier, per 1M tokens in USD')
        throw new Error('Gemini price columns changed');
    const rates = {}, later = {};
    for (const [label, field] of [['Input price', 'input'], ['Output price (including thinking tokens)', 'output'], ['Context caching price', 'cacheRead']]) {
        const matches = rows.filter(row => row[0] === label);
        const row = matches[0];
        if (matches.length !== 1 || row.length !== 3 || row[1] !== 'Not available')
            throw new Error('Gemini price rows changed');
        const policy = field === 'cacheRead' ? ' Implicit caching only (explicit caching is not supported).' : '';
        if (!row[2].endsWith(policy))
            throw new Error('Gemini implicit cache policy changed');
        const value = policy ? row[2].slice(0, -policy.length) : row[2];
        const prices = value.match(/^\$(\d+(?:\.\d+)?) through November 30, 2026\. \$(\d+(?:\.\d+)?) starting December 1, 2026\.$/);
        if (!prices)
            throw new Error('Gemini dated price policy changed');
        rates[field] = Number(prices[1]);
        later[field] = Number(prices[2]);
    }
    // Google publishes calendar dates; UTC is this application's explicit boundary convention.
    return { 'gemini-4-argon': { rates, dateChange: { at: '2026-12-01T00:00:00.000Z', rates: later } } };
}
//# sourceMappingURL=pricing-google.js.map