import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface PidEntry {
  pid: number;
  agentId: string;
  spawnedAt: number;
  parentPid: number;
}

function pidsFilePath(): string {
  const stateHome =
    process.env['XDG_STATE_HOME'] ?? path.join(os.homedir(), '.local/state');
  return path.join(stateHome, 'copilot-orch', 'pids.json');
}

function ensureDir(): void {
  fs.mkdirSync(path.dirname(pidsFilePath()), { recursive: true });
}

export async function readPids(): Promise<PidEntry[]> {
  try {
    const content = fs.readFileSync(pidsFilePath(), 'utf-8');
    return JSON.parse(content) as PidEntry[];
  } catch {
    return [];
  }
}

export async function addPid(entry: PidEntry): Promise<void> {
  ensureDir();
  const pids = await readPids();
  pids.push(entry);
  fs.writeFileSync(pidsFilePath(), JSON.stringify(pids, null, 2));
}

export async function removePid(pid: number): Promise<void> {
  const pids = await readPids();
  const filtered = pids.filter((e) => e.pid !== pid);
  ensureDir();
  fs.writeFileSync(pidsFilePath(), JSON.stringify(filtered, null, 2));
}

export async function clearAll(): Promise<void> {
  ensureDir();
  fs.writeFileSync(pidsFilePath(), '[]');
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
