#!/usr/bin/env tsx
// Emergency reaper — kill all tracked agent PIDs

import { readPids, clearAll, isProcessAlive } from '../src/agent/pids-file.js';

async function main(): Promise<void> {
  const pids = await readPids();

  if (pids.length === 0) {
    process.stderr.write('Nenhum PID registrado.\n');
    process.exit(0);
  }

  let killed = 0;
  for (const entry of pids) {
    if (isProcessAlive(entry.pid)) {
      try {
        process.kill(entry.pid, 'SIGKILL');
        process.stderr.write(`Killed PID ${entry.pid} (agent ${entry.agentId})\n`);
        killed++;
      } catch {
        process.stderr.write(`Failed to kill PID ${entry.pid}\n`);
      }
    } else {
      process.stderr.write(`PID ${entry.pid} already dead\n`);
    }
  }

  await clearAll();
  process.stderr.write(`\nReaped ${killed} process(es), cleared PID file.\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Erro: ${(err as Error).message}\n`);
  process.exit(1);
});
