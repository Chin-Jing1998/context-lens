var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import path from 'node:path';
import { getGitStatus } from '../git.js';
const recent = new Map();
export function readWorkspaceGit(cwd) {
    if (!path.isAbsolute(cwd))
        return Promise.resolve(null);
    const now = Date.now(), cached = recent.get(cwd);
    if (cached && now - cached.at < 8_000)
        return cached.value;
    // 复用终端 HUD 的受限 Git 探测。这里不接收附加命令或外部用量路径。
    const entry = new URL('../../collector.mjs', import.meta.url);
    const value = import(__rewriteRelativeImportExtension(entry.href)).then(({ createProbes }) => getGitStatus(createProbes({ cwd, argv: [] }), { lineDiffs: true })).catch(() => null);
    if (recent.size >= 32 && !cached)
        recent.delete(recent.keys().next().value);
    recent.set(cwd, { at: now, value });
    return value;
}
//# sourceMappingURL=workspace.js.map