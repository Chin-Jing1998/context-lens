import { statSync } from 'node:fs';
import { captureClaude, claudeLaunchSettings, validId } from './sessions.js';
import { resolveClaudeSettings } from './settings.js';
import type { StdinData } from '../types.js';

export function captureStatusline(stdin: StdinData, showTerminal: boolean, hudWindow: number | null): number | null {
  const launch = claudeLaunchSettings();
  try {
    captureClaude(stdin, launch, hudWindow ?? undefined);
  } catch {
    // 桌面端会显示采集缺失状态。
  }
  if (!showTerminal) return null;

  const settings = resolveClaudeSettings({
    cwd: stdin.workspace?.project_dir || stdin.cwd || process.cwd(),
    model: typeof stdin.model?.id === 'string' ? stdin.model.id : '',
    capacity: stdin.context_window?.context_window_size ?? null,
    launch,
  });
  return settings.budget.accuracy === 'configured' ? settings.budget.tokens : null;
}

export async function extendedStatusline(stdin: StdinData, columns: number): Promise<string[]> {
  const file = stdin.transcript_path;
  if (!validId(stdin.session_id) || typeof file !== 'string' || !file) return [];

  const stat = statSync(file);
  const { SessionCollector } = await import('./snapshot.js');
  const { renderLensLines } = await import('./terminal.js');
  const snapshot = await new SessionCollector().snapshot({
    client: 'claude', id: stdin.session_id, cwd: stdin.cwd || '', model: stdin.model?.id || '',
    file, updatedAt: stat.mtime.toISOString(), size: stat.size, mtimeMs: stat.mtimeMs,
  });
  return renderLensLines(snapshot, columns);
}
