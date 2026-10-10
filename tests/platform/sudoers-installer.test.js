import test from 'node:test';
import { execFileSync } from 'node:child_process';

test('scoped sudoers installer validates and rolls back without changing host policy', () => {
  execFileSync('python3', ['tests/platform/sudoers-installer.test.py'], { stdio: 'pipe' });
});
