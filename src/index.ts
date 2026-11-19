// 供现有状态栏启动器从 dist/index.js 或 src/index.ts 进入。
// @ts-expect-error 上游 JavaScript 启动器由 Node 直接加载，不编译进 dist。
export { isHudDisabled, main } from '../hud.mjs';
