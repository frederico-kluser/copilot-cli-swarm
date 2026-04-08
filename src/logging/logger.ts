import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

function logDir(): string {
  return (
    process.env['COPILOT_ORCH_LOG_DIR'] ??
    path.join(
      process.env['XDG_DATA_HOME'] ?? path.join(os.homedir(), '.local/share'),
      'copilot-orch',
      'logs',
    )
  );
}

function createLogFile(): string {
  const dir = logDir();
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(dir, `session-${ts}.ndjson`);
}

export const logFilePath = createLogFile();

const dest = pino.destination({ dest: logFilePath, sync: true });

export const logger = pino(
  {
    level: process.env['COPILOT_ORCH_LOG_LEVEL'] ?? 'info',
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  dest,
);

export function createAgentLogger(agentId: string) {
  return logger.child({ agentId });
}
