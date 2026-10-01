import { label } from '../colors.js';
import { t } from '../../i18n/index.js';
export function renderCacheHitRateLine(ctx) {
    const ratio = ctx.stdin.prompt_cache?.hit_ratio;
    if (ctx.config?.display?.showCacheHitRate !== true || typeof ratio !== 'number' || !Number.isFinite(ratio)) {
        return null;
    }
    const percent = Math.min(100, Math.max(0, ratio * 100));
    return `${label(t('label.cacheHitRate'), ctx.config?.colors)} ${percent.toFixed(1)}%`;
}
//# sourceMappingURL=cache-hit-rate.js.map