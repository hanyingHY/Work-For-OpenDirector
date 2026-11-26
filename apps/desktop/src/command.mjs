import { readFile, readlink, mkdir, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

export async function registerCommand({ destination, launcher }) {
  await mkdir(dirname(destination), { recursive: true });
  const windows = process.platform === 'win32';
  const script = `@"${launcher}" %*\r\n`;
  try {
    if (windows) await writeFile(destination, script, { flag: 'wx' });
    else await symlink(launcher, destination);
    return 'installed';
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const matches = windows
    ? await readFile(destination, 'utf8').then(value => value === script, () => false)
    : await readlink(destination).then(value => value === launcher, () => false);
  if (matches) return 'already_installed';
  throw new Error('command_collision');
}

export const commandPath = home => join(home, '.local', 'bin', process.platform === 'win32' ? 'opendirector.cmd' : 'opendirector');

/**
 * Issue #475: Diagnose whether the installed desktop launcher is visible on PATH
 * and whether another installation (e.g. Conda / pip) takes precedence.
 */
export function diagnoseCommand({
  destination,
  envPath = process.env.PATH ?? '',
  platform = process.platform,
  exists = existsSync,
}) {
  const sep = platform === 'win32' ? ';' : ':';
  const norm = value => {
    const clean = normalize(value).replace(/[\\/]+$/, '');
    return platform === 'win32' ? clean.toLowerCase() : clean;
  };
  const destDir = dirname(destination);
  const destNorm = norm(destDir);
  const entries = envPath.split(sep).map(s => s.trim()).filter(Boolean);
  const candidateNames = platform === 'win32'
    ? ['opendirector.cmd', 'opendirector.exe', 'opendirector.bat']
    : ['opendirector'];

  let inPath = false;
  let resolvedPath = null;
  let shadowedBy = null;

  for (const dir of entries) {
    const sameDir = norm(dir) === destNorm;
    if (sameDir) inPath = true;
    for (const name of candidateNames) {
      const candidate = join(dir, name);
      if (exists(candidate)) {
        if (!resolvedPath) resolvedPath = candidate;
        if (!sameDir && !shadowedBy && norm(candidate) !== norm(destination)) {
          shadowedBy = candidate;
        }
      }
    }
  }

  const verifyCommands = platform === 'win32'
    ? [
        '(Get-Command opendirector).Source',
        'opendirector --help',
        'opendirector desktop',
      ]
    : [
        'command -v opendirector',
        'opendirector --help',
        'opendirector desktop',
      ];

  const addToPathHint = platform === 'win32'
    ? `[Environment]::SetEnvironmentVariable("Path", "${destDir};" + [Environment]::GetEnvironmentVariable("Path", "User"), "User")`
    : `export PATH="${destDir}:$PATH"`;

  return {
    destination,
    destDir,
    inPath,
    resolvedPath,
    shadowedBy,
    verifyCommands,
    addToPathHint,
  };
}
