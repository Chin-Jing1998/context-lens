import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { signDesktop, notarizeDesktop } from '../scripts/macos-signing.mjs';

const app = '/build/Context Lens.app';
const identity = 'Developer ID Application: Context Lens (ABCDEFGHIJ)';
const signed = () => `Authority=${identity}\nCodeDirectory flags=0x10000(runtime)`;

test('macOS distribution signs its bundled runtime with release entitlements before sealing the app', () => {
  const calls = [];
  signDesktop(app, identity, (tool, args) => calls.push({ tool, args }));
  assert.equal(calls[0].args.at(-1), app + '/Contents/Resources/runtime/node');
  assert.equal(calls[1].args.at(-1), app);
  for (const call of calls.slice(0, 2)) {
    assert.ok(call.args.includes('--timestamp'));
    assert.ok(call.args.includes('runtime'));
  }
  const plist = readFileSync(calls[0].args[calls[0].args.indexOf('--entitlements') + 1], 'utf8');
  assert.match(plist, /allow-jit/);
  assert.doesNotMatch(plist, /get-task-allow|disable-library-validation|allow-dyld-environment-variables/);
  assert.deepEqual(calls[2].args.slice(0, 3), ['--verify', '--deep', '--strict']);
});

test('development and ad-hoc identities cannot enter the distribution signing path', () => {
  for (const invalid of ['-', 'Apple Development: Context Lens']) {
    assert.throws(() => signDesktop(app, invalid, () => assert.fail('must not sign')), /Developer ID Application/);
  }
});

test('notarization refuses missing credentials and ad-hoc signatures before uploading', () => {
  const noUpload = () => assert.fail('must not upload');
  assert.throws(() => notarizeDesktop(app, '', noUpload, signed), /MAC_NOTARY_PROFILE/);
  assert.throws(() => notarizeDesktop(app, 'profile', noUpload, () => 'Signature=adhoc'), /Developer ID signing/);
});

test('rejected submissions cannot staple tickets or claim Gatekeeper success', () => {
  const calls = [];
  assert.throws(() => notarizeDesktop(app, 'profile', (tool, args) => {
    calls.push({ tool, args });
    if (args[0] === 'notarytool') return JSON.stringify({ status: 'Invalid' });
  }, signed), /did not accept/);
  assert.equal(calls.length, 2);
  assert.equal(existsSync(calls[0].args.at(-1)), false);
});

test('accepted notarization requires a valid stapled ticket and an actual Gatekeeper pass', () => {
  const calls = [];
  const run = (tool, args) => {
    calls.push({ tool, args });
    if (args[0] === 'notarytool') return JSON.stringify({ status: 'Accepted' });
  };
  assert.equal(notarizeDesktop(app, 'profile', run, signed).status, 'Accepted');
  assert.deepEqual(calls.slice(-3).map(call => [call.tool, ...call.args.slice(0, 2)]), [
    ['xcrun', 'stapler', 'staple'], ['xcrun', 'stapler', 'validate'], ['spctl', '--assess', '--type'],
  ]);
  assert.throws(() => notarizeDesktop(app, 'profile', (tool, args) => {
    if (tool === 'spctl') throw new Error('Gatekeeper rejected');
    return run(tool, args);
  }, signed), /Gatekeeper rejected/);
});
