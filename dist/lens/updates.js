import { readFileSync } from 'node:fs';
export const updateSource = 'https://github.com/Chin-Jing1998/context-lens';
export const currentVersion = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
export function newerVersion(candidate, current) {
    const parse = (value) => /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value)?.slice(1).map(Number);
    const next = parse(candidate), installed = parse(current);
    if (!next || !installed)
        return false;
    for (let i = 0; i < 3; i++)
        if (next[i] !== installed[i])
            return next[i] > installed[i];
    return false;
}
export const updateInfo = () => ({ current: currentVersion, latest: null, available: false, state: 'idle', source: updateSource, release: null, publishedAt: null });
export async function checkUpdates(request = fetch) {
    const result = updateInfo();
    const response = await request('https://api.github.com/repos/Chin-Jing1998/context-lens/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Context-Lens/' + currentVersion, 'X-GitHub-Api-Version': '2022-11-28' },
        signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (response.status === 404)
        return { ...result, state: 'unpublished' };
    if (!response.ok)
        throw new Error(response.status === 403 || response.status === 429 ? 'GitHub 查询暂受限制，请稍后重试' : '暂时无法连接 GitHub，请重试');
    const release = await response.json();
    if (release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name)
        || release.html_url !== updateSource + '/releases/tag/' + release.tag_name)
        throw new Error('GitHub 版本记录无效');
    const available = newerVersion(release.tag_name, currentVersion);
    return { ...result, latest: release.tag_name.replace(/^v/, ''), available, state: available ? 'available' : 'current',
        release: release.html_url, publishedAt: typeof release.published_at === 'string' ? release.published_at : null };
}
//# sourceMappingURL=updates.js.map