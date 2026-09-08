import test from 'node:test';
import assert from 'node:assert/strict';
import { pickNativeFolder } from '../inspector/server/native-folder-picker.mjs';

test('native chooser uses fixed commands, preserves spaces and handles cancellation', async () => {
  for (const [platform, expected] of [['darwin', '/usr/bin/osascript'], ['win32', 'powershell.exe'], ['linux', 'zenity']]) {
    const result = await pickNativeFolder({ platform, run: async (command, args, options) => {
      assert.equal(command, expected);
      assert.ok(args.length > 0);
      assert.equal(options.maxBuffer, 16384);
      return { stdout: '/tmp/my project\n' };
    } });
    assert.equal(result.path, '/tmp/my project');
    assert.equal(result.cancelled, false);
  }
  assert.deepEqual(await pickNativeFolder({ platform: 'darwin', run: async () => ({ stdout: '\n' }) }), { cancelled: true });
  assert.deepEqual(await pickNativeFolder({ platform: 'linux', run: async () => { throw Object.assign(new Error(), { code: 1 }); } }), { cancelled: true });
  await assert.rejects(pickNativeFolder({ platform: 'linux', run: async () => { throw Object.assign(new Error(), { code: 'ENOENT' }); } }), /manual folder browser/);
});

test('only one native chooser may be open and failures release the lock', async () => {
  let finish;
  const first = pickNativeFolder({ platform: 'darwin', run: () => new Promise(resolve => { finish = resolve; }) });
  await assert.rejects(pickNativeFolder(), /already open/);
  finish({ stdout: '' }); await first;
  await assert.rejects(pickNativeFolder({ platform: 'unsupported' }), /unavailable/);
  assert.deepEqual(await pickNativeFolder({ platform: 'darwin', run: async () => ({ stdout: '' }) }), { cancelled: true });
});
