import { afterEach, describe, expect, test } from '@jest/globals';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, lstatSync, symlinkSync } from 'fs';
import { dirname, join } from 'path';
import { platform, tmpdir } from 'os';
import { prepareExternalCamoufoxExecutable } from '../../lib/camoufox-executable.js';

const tempDirs = [];
const shimDirs = [];

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'camofox-executable-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    const fonts = join(dir, 'fontconfig');
    if (existsSync(fonts) && !lstatSync(fonts).isSymbolicLink()) chmodSync(fonts, 0o700);
    rmSync(dir, { recursive: true, force: true });
  }
  for (const dir of shimDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('prepareExternalCamoufoxExecutable', () => {
  test('creates Camoufox compatibility links for an external bundle', () => {
    const bundleDir = makeTempDir();
    const cacheDir = makeTempDir();
    const executable = join(bundleDir, 'camoufox-bin');

    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    writeFileSync(join(bundleDir, 'properties.json'), '[]\n');
    writeFileSync(join(bundleDir, 'version.json'), '{"version":"135.0.1","release":"beta.24"}\n');
    writeFileSync(join(bundleDir, 'application.ini'), '[App]\nVersion=156.0.1\n');
    mkdirSync(join(bundleDir, 'fontconfig', 'lin'), { recursive: true });

    chmodSync(join(bundleDir, 'fontconfig'), 0o555);
    const prepared = prepareExternalCamoufoxExecutable(executable, { cacheDir });

    shimDirs.push(dirname(prepared.executablePath));
    expect(prepared.resourceDir).toBe(bundleDir);
    expect(prepared.executablePath).toContain('camofox-browser-external-camoufox');
    expect(existsSync(prepared.executablePath)).toBe(true);
    expect(readFileSync(join(dirname(prepared.executablePath), 'application.ini'), 'utf8')).toContain('Version=156.0.1');
    expect(existsSync(join(cacheDir, 'version.json'))).toBe(true);
    expect(existsSync(join(cacheDir, 'fontconfig'))).toBe(true);
    expect(lstatSync(join(cacheDir, 'fontconfig')).isSymbolicLink()).toBe(false);
    writeFileSync(join(cacheDir, 'fontconfig', 'fonts-test.conf'), 'private generated configuration');
    expect(existsSync(join(bundleDir, 'fontconfig', 'fonts-test.conf'))).toBe(false);

    // Repair caches prepared by the previous directory-symlink implementation.
    rmSync(join(cacheDir, 'fontconfig'), { recursive: true });
    symlinkSync(join(bundleDir, 'fontconfig'), join(cacheDir, 'fontconfig'), 'dir');
    prepareExternalCamoufoxExecutable(executable, { cacheDir });
    expect(lstatSync(join(cacheDir, 'fontconfig')).isSymbolicLink()).toBe(false);
    writeFileSync(join(cacheDir, 'fontconfig', 'fonts-repaired.conf'), 'private');
    expect(existsSync(join(bundleDir, 'fontconfig', 'fonts-repaired.conf'))).toBe(false);
    expect(existsSync(join(cacheDir, 'properties.json'))).toBe(true);
    const cacheExecutable = platform() === 'darwin'
      ? join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox')
      : join(cacheDir, platform() === 'win32' ? 'camoufox.exe' : 'camoufox-bin');
    expect(existsSync(cacheExecutable)).toBe(true);
  });

  test('preserves a macOS app bundle executable instead of flattening it', () => {
    if (platform() !== 'darwin') return;
    const root = makeTempDir();
    const cacheDir = makeTempDir();
    const contents = join(root, 'Camoufox.app', 'Contents');
    const executable = join(contents, 'MacOS', 'camoufox');
    mkdirSync(dirname(executable), { recursive: true });
    mkdirSync(join(contents, 'Resources'), { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    writeFileSync(join(root, 'version.json'), '{"version":"test"}\n');
    writeFileSync(join(contents, 'Resources', 'properties.json'), '[]\n');

    const prepared = prepareExternalCamoufoxExecutable(executable, { cacheDir });

    expect(prepared.resourceDir).toBe(join(contents, 'Resources'));
    expect(prepared.executablePath).toBe(executable);
    expect(existsSync(join(cacheDir, 'version.json'))).toBe(true);
    expect(existsSync(join(dirname(executable), 'properties.json'))).toBe(true);
  });

  test('fails clearly when bundle resources are missing', () => {
    const bundleDir = makeTempDir();
    const executable = join(bundleDir, 'camoufox-bin');
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);

    expect(() => prepareExternalCamoufoxExecutable(executable, { cacheDir: makeTempDir() }))
      .toThrow(/properties\.json/);
  });
});
