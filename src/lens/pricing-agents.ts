import type { OfficialPrice } from './pricing.js';
import type { Rate } from './types.js';

function plain(value: string): string { return value.replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim(); }
/** Expand the published row/column spans instead of relying on their visual position. */
function table(document: string): string[][] {
  const rows: string[][] = [];
  const source = document.match(/<table\b[^>]*>[\s\S]*?<\/table>/i)?.[0]; if (!source) throw new Error('Official table is missing');
  for (const [r, match] of [...source.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].entries()) {
    const row = rows[r] ??= []; let c = 0;
    for (const cell of match[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      while (row[c] !== undefined) c++;
      const span = (name: string) => Number(new RegExp(name + '=["\x27]?(\\d+)', 'i').exec(cell[1])?.[1] ?? 1);
      const width = span('colspan'), height = span('rowspan');
      if (width < 1 || width > 16 || height < 1 || height > 20 || r > 200) throw new Error('Unexpected official table spans');
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) (rows[r + y] ??= [])[c + x] = plain(cell[2]);
      c += width;
    }
  }
  return rows;
}
function usd(cell: string): number {
  const m = cell.replaceAll('\\', '').match(/^\$(\d+(?:\.\d+)?)$/); if (!m) throw new Error('Invalid official USD rate'); return Number(m[1]);
}
export function parseAgentPrices(provider: 'deepseek' | 'mimo' | 'zai', document: string): Record<string, OfficialPrice> {
  const models: Record<string, OfficialPrice> = Object.create(null);
  if (provider === 'deepseek') {
    if (!/01:00\s*-\s*04:00 and 06:00\s*-\s*10:00 UTC, Monday through Friday, excluding Chinese public holidays/.test(plain(document))) throw new Error('DeepSeek time policy changed');
    const rows = table(document), ids = rows.find(r => r[0] === 'MODEL')?.slice(3);
    if (!ids?.length || ids.some(id => !/^deepseek-[a-z0-9.-]+$/.test(id))) throw new Error('DeepSeek model columns changed');
    for (const [i, model] of ids.entries()) {
      const rates: Rate = {}, offPeak: Rate = {};
      for (const [label, field] of [['1M INPUT TOKENS (CACHE HIT)', 'cacheRead'], ['1M INPUT TOKENS (CACHE MISS)', 'input'], ['1M OUTPUT TOKENS', 'output']] as const) {
        const peak = rows.find(r => r[1] === label && r[2] === 'PEAK'), off = rows.find(r => r[1] === label && r[2] === 'OFF-PEAK');
        if (!peak || !off) throw new Error('DeepSeek price rows changed'); rates[field] = usd(peak[i + 3]); offPeak[field] = usd(off[i + 3]);
      }
      rates.cacheWrite = rates.input; offPeak.cacheWrite = offPeak.input;
      models[model] = { rates, timePolicy: 'deepseek', tiers: { 'off-peak': { rates: offPeak } } };
    }
    if (models['deepseek-flash'] && document.includes('deepseek-v4-flash') && document.includes('billed at the Flash price')) {
      models['deepseek-v4-flash'] = models['deepseek-flash']; models['deepseek-v4-flash-vision-exp'] = models['deepseek-flash'];
    }
  } else if (provider === 'mimo') {
    if (!document.includes('Cache Write: Limited-time Free')) throw new Error('MiMo cache-write policy changed');
    const section = document.split('### Overseas Pricing of the Model')[1]?.split('### Pricing for Web Search')[0];
    if (!section) throw new Error('MiMo USD section missing');
    const rows = table(section);
    if (rows[0]?.join('|') !== 'Inference Type|Model Name|Input (Cache Hit)|Input (Cache Miss)|Output') throw new Error('MiMo price columns changed');
    for (const row of rows.slice(1)) {
      if (row.length !== 5 || !['Real-time API', 'Batch API'].includes(row[0])) throw new Error('MiMo pricing tier changed');
      const ids = [...row[1].matchAll(/mimo-v[\d.]+(?:-[a-z]+)*/g)].map(m => m[0]);
      if (!ids.length) throw new Error('MiMo models missing');
      const rates: Rate = { cacheRead: usd(row[2]), input: usd(row[3]), output: usd(row[4]), cacheWrite: 0 };
      for (const id of ids) {
        if (row[0] === 'Real-time API') { if (models[id]) throw new Error('Duplicate MiMo price'); models[id] = { rates }; }
        else { if (!models[id]) throw new Error('Missing MiMo base price'); (models[id].tiers ??= {}).batch = { rates }; }
      }
    }
  } else {
    if (!document.includes('| Model | Input | Cached Input | Cached Input Storage | Output |')) throw new Error('Z.ai price columns changed');
    const body = document.split('### Built-in Tools')[0];
    for (const line of body.split('\n')) {
      const row = line.trim().split('|').slice(1, -1).map(s => s.trim());
      if (!/^GLM-[\w.-]+$/.test(row[0] ?? '')) continue;
      if (row.length !== 5) throw new Error('Z.ai price table changed');
      const value = (s: string): number | undefined => s === 'Free' ? 0 : s === '-' || s === '\\' || s === '\\\\' ? undefined : usd(s);
      const rates: Rate = { input: value(row[1]), cacheRead: value(row[2]), output: value(row[4]) };
      if (rates.input === undefined || rates.output === undefined) throw new Error('Missing Z.ai price');
      // Storage is a separate line item; initial prompt ingestion is charged at input rates.
      rates.cacheWrite = rates.input;
      for (const field of Object.keys(rates) as (keyof Rate)[]) if (rates[field] === undefined) delete rates[field];
      models[row[0].toLowerCase()] = { rates };
    }
  }
  if (Object.keys(models).length < 2) throw new Error('Incomplete agent model prices');
  return models;
}

// Official 2026 public holiday schedule: https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
const holidays2026 = [['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'], ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07']];
export function deepSeekTier(at?: string): 'standard' | 'off-peak' | undefined {
  if (!at || !Number.isFinite(Date.parse(at))) return undefined;
  const time = new Date(at), day = time.getUTCDay(), hour = time.getUTCHours();
  if (day === 0 || day === 6 || !(hour >= 1 && hour < 4 || hour >= 6 && hour < 10)) return 'off-peak';
  const chinaDate = new Date(time.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (!chinaDate.startsWith('2026-')) return undefined;
  const date = chinaDate.slice(5);
  return holidays2026.some(([start, end]) => date >= start && date <= end) ? 'off-peak' : 'standard';
}
