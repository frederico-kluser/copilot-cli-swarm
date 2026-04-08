#!/usr/bin/env tsx
// Cleanup orphan worktrees left by crashed orchestrator

import { WorktreeManager } from '../src/worktree/WorktreeManager.js';

async function main(): Promise<void> {
  const repoDir = process.cwd();
  const wm = new WorktreeManager(repoDir);
  const pruned = await wm.pruneOrphans();
  process.stderr.write(`Removidas ${pruned} worktrees órfãs\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Erro: ${(err as Error).message}\n`);
  process.exit(1);
});
