/**
 * Tiny logger that scrubs anything that looks like a secret before printing.
 * We never log request bodies, document text, API keys or webhook URLs.
 */
const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_\-]{20,}/g, // Google API keys
  /https:\/\/hooks\.slack\.com\/[^\s"']+/g,
  /https:\/\/(?:\w+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"']+/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /"private_key"\s*:\s*"[^"]*"/g,
  /Bearer\s+[A-Za-z0-9._\-]+/g,
];

function scrub(value: unknown): string {
  let text: string;
  if (value instanceof Error) text = `${value.name}: ${value.message}`;
  else if (typeof value === 'string') text = value;
  else {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  }
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[REDACTED]');
  return text;
}

function write(level: 'info' | 'warn' | 'error', msg: string, extra?: unknown) {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scrub(msg)}${
    extra !== undefined ? ' ' + scrub(extra) : ''
  }`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (msg: string, extra?: unknown) => write('info', msg, extra),
  warn: (msg: string, extra?: unknown) => write('warn', msg, extra),
  error: (msg: string, extra?: unknown) => write('error', msg, extra),
  scrub,
};
