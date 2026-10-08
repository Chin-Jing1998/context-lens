import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entitlements = fileURLToPath(new URL('../desktop/node-entitlements.plist', import.meta.url));

export function signDesktop(app, identity = process.env.CONTEXT_LENS_MAC_SIGNING_IDENTITY, run = execFileSync) {
  if (identity && !identity.startsWith('Developer ID Application:')) {
    throw new Error('Distribution signing requires a Developer ID Application identity');
  }
  if (identity) {
    // Sign the bundled runtime explicitly; development Node binaries can carry get-task-allow.
    run('codesign', ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', '--entitlements', entitlements, path.join(app, 'Contents/Resources/runtime/node')], { stdio: 'pipe' });
    run('codesign', ['--force', '--sign', identity, '--options', 'runtime', '--timestamp', app], { stdio: 'pipe' });
  } else {
    run('codesign', ['--force', '--sign', '-', app], { stdio: 'pipe' });
    console.warn('Local ad-hoc signature: browser-downloaded macOS packages require a launch exception until Developer ID signing and Apple notarization are complete.');
  }
  run('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'pipe' });
}

export function notarizeDesktop(app, profile = process.env.CONTEXT_LENS_MAC_NOTARY_PROFILE, run = execFileSync, inspect = captureSignature) {
  if (!profile) throw new Error('Apple notarization requires CONTEXT_LENS_MAC_NOTARY_PROFILE, an existing notarytool keychain profile');
  const details = inspect(app);
  if (!details.includes('Authority=Developer ID Application:') || !details.includes('runtime')) {
    throw new Error('Apple notarization requires Developer ID signing and Hardened Runtime');
  }
  const folder = mkdtempSync(path.join(os.tmpdir(), 'context-lens-notary-'));
  try {
    const archive = path.join(folder, 'Context Lens.zip');
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', app, archive], { stdio: 'pipe' });
    const result = JSON.parse(run('xcrun', ['notarytool', 'submit', archive, '--keychain-profile', profile, '--wait', '--output-format', 'json'], { encoding: 'utf8' }));
    if (result.status !== 'Accepted') throw new Error(`Apple notarization did not accept the application: ${result.status ?? 'unknown'}`);
    run('xcrun', ['stapler', 'staple', app], { stdio: 'pipe' });
    run('xcrun', ['stapler', 'validate', app], { stdio: 'pipe' });
    run('spctl', ['--assess', '--type', 'execute', '--verbose=4', app], { stdio: 'pipe' });
    return result;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

function captureSignature(app) {
  // No shell, passwords or account identifiers are passed to the signing tools.
  const result = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot inspect the macOS application signature', { cause: result.error });
  return result.stderr;
}
