import test from 'node:test';
import { execFileSync } from 'node:child_process';
test('network helper checks command failures and verifies cleanup postconditions', () => {
  execFileSync('python3', ['tests/platform/netns-helper.test.py'], {stdio:'pipe'});
});
