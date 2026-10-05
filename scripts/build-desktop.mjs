import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

export async function buildDesktop(port = 47831) {
  if (process.platform !== 'darwin') throw new Error('The floating ball currently supports macOS. Use context-lens serve on other platforms.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Desktop port must be between 1 and 65535');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const app = path.join(root, 'desktop/build/Context Lens.app');
  const binary = path.join(app, 'Contents/MacOS/ContextLens');
  const source = path.join(root, 'desktop/ContextLens.swift');
  mkdirSync(path.dirname(binary), { recursive: true });
  mkdirSync(path.join(app, 'Contents/Resources'), { recursive: true });
  let built = 0;
  try { built = statSync(binary).mtimeMs; } catch { /* First build. */ }
  if (statSync(source).mtimeMs > built) {
    execFileSync('xcrun', ['swiftc', '-O', '-parse-as-library', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx13.0`, '-framework', 'AppKit', '-framework', 'WebKit', source, '-o', binary], { stdio: 'inherit' });
  }
  writeFileSync(path.join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>ContextLens</string>
<key>CFBundleIdentifier</key><string>io.github.Chin-Jing1998.context-lens</string>
<key>CFBundleName</key><string>Context Lens</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>LSMinimumSystemVersion</key><string>13.5</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>\n`);
  const runtime = path.join(app, 'Contents/Resources/runtime');
  mkdirSync(path.join(runtime, 'scripts'), { recursive: true });
  for (const file of ['dist', 'web', 'package.json', 'LICENSE']) cpSync(path.join(root, file), path.join(runtime, file), { recursive: true });
  cpSync(path.join(root, 'scripts/context-lens.mjs'), path.join(runtime, 'scripts/context-lens.mjs'));
  cpSync(process.execPath, path.join(runtime, 'node'), { dereference: true });
  const licensePath = path.join(runtime, `Node-${process.versions.node}-LICENSE.txt`);
  if (!existsSync(licensePath)) {
    const response = await fetch(`https://raw.githubusercontent.com/nodejs/node/v${process.versions.node}/LICENSE`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Cannot obtain the bundled Node.js license: HTTP ${response.status}`);
    writeFileSync(licensePath, await response.text());
  }
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [location, info] of Object.entries(lock.packages)) {
    if (!location.startsWith('node_modules/') || info.dev) continue;
    cpSync(path.join(root, location), path.join(runtime, location), { recursive: true });
  }
  // The app carries its runtime and can be moved out of the checkout.
  writeFileSync(path.join(app, 'Contents/Resources/launch.json'), JSON.stringify({
    port,
    ...(process.env.CONTEXT_LENS_HOME ? { home: process.env.CONTEXT_LENS_HOME } : {}),
  }), { mode: 0o600 });
  execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
  return app;
}

const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function installDesktop(app) {
  const target = path.join(os.homedir(), 'Applications/Context Lens.app');
  mkdirSync(path.dirname(target), { recursive: true });
  const label = 'io.github.Chin-Jing1998.context-lens';
  const domain = `gui/${process.getuid()}`;
  const agent = path.join(os.homedir(), 'Library/LaunchAgents', `${label}.plist`);
  // Stop only our registered watcher before replacing its app; existing installations stay recoverable.
  try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'pipe' }); } catch { /* Not previously installed. */ }
  if (existsSync(target)) renameSync(target, target.replace(/\.app$/, `.previous-${Date.now()}.app`));
  cpSync(app, target, { recursive: true });
  mkdirSync(path.dirname(agent), { recursive: true });
  if (existsSync(agent)) cpSync(agent, `${agent}.backup-${Date.now()}`);
  writeFileSync(agent, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(path.join(target, 'Contents/MacOS/ContextLens'))}</string><string>--background</string></array>
<key>RunAtLoad</key><true/><key>ProcessType</key><string>Interactive</string>
</dict></plist>\n`, { mode: 0o600 });
  execFileSync('launchctl', ['bootstrap', domain, agent], { stdio: 'pipe' });
  return target;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const portIndex = process.argv.indexOf('--port');
  let app = await buildDesktop(portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 47831);
  if (process.argv.includes('--install')) app = installDesktop(app);
  if (process.argv.includes('--open') && !process.argv.includes('--install')) execFileSync('open', ['-a', app], { stdio: 'pipe' });
  console.log(app);
}
