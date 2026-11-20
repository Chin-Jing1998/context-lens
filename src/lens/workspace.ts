import path from 'node:path';
import type { Ask } from '../channel.js';
import { getGitStatus, type GitStatus } from '../git.js';

const recent = new Map<string, { at: number; value: Promise<GitStatus | null> }>();

export function readWorkspaceGit(cwd: string): Promise<GitStatus | null> {
  if (!path.isAbsolute(cwd)) return Promise.resolve(null);
  const now = Date.now(), cached = recent.get(cwd);
  if (cached && now - cached.at < 8_000) return cached.value;
  // 复用终端 HUD 的受限 Git 探测。这里不接收附加命令或外部用量路径。
  const entry = new URL('../../collector.mjs', import.meta.url);
  const value = import(entry.href).then(({ createProbes }: { createProbes(options: { cwd: string; argv: string[] }): Ask }) =>
    getGitStatus(createProbes({ cwd, argv: [] }), { lineDiffs: true })).catch(() => null);
  if (recent.size >= 32 && !cached) recent.delete(recent.keys().next().value!);
  recent.set(cwd, { at: now, value });
  return value;
}
