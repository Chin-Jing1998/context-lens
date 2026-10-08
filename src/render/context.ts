import type { Frame } from './frame.js';
import { coloredBar, getContextColor, label, RESET } from './colors.js';
import { t } from '../i18n/index.js';
import { formatContextValue, formatTokens } from '../utils/format.js';
import { contextUsage } from './derive.js';
import { barLabel, type LabelAlign } from './labels.js';

function thresholds(f: Frame) {
  return {
    warning: f.config?.display?.contextWarningThreshold,
    critical: f.config?.display?.contextCriticalThreshold,
  };
}

/** The context bar (when shown) and value, e.g. `█████░░░░░ 45%`. */
export function contextBarAndValue(f: Frame): { bar: string | null; value: string } {
  const display = f.config?.display;
  const colors = f.config?.colors;
  const context = contextUsage(f);

  const format = display?.compactContextFormat ?? 'full';
  const mode = display?.contextValue ?? 'percent';

  // minimal 格式强制使用 percent 模式
  const valueMode = format === 'minimal' ? 'percent' : mode;

  const value = `${getContextColor(context.percent, colors, thresholds(f))}${formatContextValue(context, valueMode)}${RESET}`;
  const bar = display?.showContextBar !== false
    ? coloredBar(context.percent, f.barWidth, colors, thresholds(f))
    : null;
  return { bar, value };
}

/** ` (in: 12k, cache: 180k)` when context reaches the configured threshold. */
export function tokenBreakdown(f: Frame): string {
  const display = f.config?.display;
  const usage = f.stdin.context_window?.current_usage;
  if (display?.showTokenBreakdown === false || !usage) return '';

  const mode = display?.contextDetailMode ?? 'critical';
  const context = contextUsage(f);

  // 根据模式判断是否显示
  if (mode === 'never') return '';
  if (mode === 'always') {
    // 始终显示
  } else if (mode === 'warning') {
    const threshold = display?.contextWarningThreshold ?? 70;
    if (context.percent < threshold) return '';
  } else { // 'critical'
    const threshold = display?.contextCriticalThreshold ?? 85;
    if (context.percent < threshold) return '';
  }

  const input = formatTokens(usage.input_tokens ?? 0);
  const cache = formatTokens((usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0));
  return label(` (${t('format.in')}: ${input}, ${t('format.cache')}: ${cache})`, f.config?.colors);
}

export function contextLine(f: Frame, align: LabelAlign = {}): string {
  const { bar, value } = contextBarAndValue(f);
  const prefix = barLabel('label.context', f.config?.colors, align);
  return `${prefix} ${bar ? `${bar} ` : ''}${value}${tokenBreakdown(f)}`;
}
