/**
 * One-click Windows diagnostics summary and redacted log collector.
 * Never leaks bearer tokens, API keys, or X-OpenDirector-Desktop secrets.
 */
import { readFileSync } from 'node:fs';

const SECRET_PATTERNS = [
  [/(x-opendirector-desktop["'\s:=]+)[a-f0-9]{16,}/gi, '$1[REDACTED]'],
  [/(authorization["'\s:=]+bearer\s+)[^\s"']+/gi, '$1[REDACTED]'],
  [/(api[_-]?key["'\s:=]+)[^\s"',}]+/gi, '$1[REDACTED]'],
  [/\bsk-[a-zA-Z0-9_-]{12,}\b/g, '[REDACTED]'],
];

export function redactSecrets(input) {
  let output = String(input ?? '');
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

export function buildDiagnosticsSummary({
  appVersion,
  platform,
  arch,
  osRelease,
  versions = {},
  runtime = {},
  uptimeSeconds = 0,
  workspace = '',
  logFile = '',
  tailLines = 40,
}) {
  const lines = [
    `OpenDirector Windows Desktop ${appVersion} (${platform}/${arch})`,
    `OS: ${platform} ${osRelease}`,
    `Electron: ${versions.electron ?? 'n/a'} · Chromium: ${versions.chrome ?? 'n/a'} · Node: ${versions.node ?? 'n/a'}`,
    ...Object.entries(runtime).map(([key, value]) => `Runtime ${key}: ${value}`),
    `Uptime: ${Math.max(0, Math.round(uptimeSeconds))}s`,
    `Workspace: ${workspace}`,
  ];
  if (logFile) {
    try {
      const content = readFileSync(logFile, 'utf8');
      const tail = content.split(/\r?\n/).filter(Boolean).slice(-tailLines);
      if (tail.length) {
        lines.push('', '--- Recent Desktop Log (redacted) ---', ...tail.map(redactSecrets));
      }
    } catch {
      // Log file may not exist yet on first run.
    }
  }
  return lines.join('\n');
}
