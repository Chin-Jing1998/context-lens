import type { Frame, Layout } from './frame.ts';
/**
 * `git:(main* ↑2)` or `jj:(…)`, plus the worktree name. Expanded adds line diffs;
 * compact adds Starship-style file counts instead. jj never shows git-only details.
 */
export declare function vcsPart(f: Frame, layout: Layout): string | null;
/** Changed files in git's order, with per-file line diffs (expanded, gitStatus.showFileStats). */
export declare function gitFilesLine(f: Frame): string | null;
//# sourceMappingURL=vcs.d.ts.map