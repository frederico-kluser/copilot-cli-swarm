/**
 * E2E integration test — real Copilot CLI
 *
 * 1. Spawna 1 agente real com prompt para criar index.txt
 * 2. Espera conclusão
 * 3. Inspeciona worktree (verifica que o arquivo existe com conteúdo correto)
 * 4. Limpa worktree
 *
 * Usage: npx tsx src/test/e2e-real.ts
 */
import { Orchestrator, type AgentTask } from '../orchestrator/Orchestrator.js';
import { simpleGit } from 'simple-git';
import fs from 'node:fs';
import path from 'node:path';

const PROMPT = 'Create a file called index.txt in the root of the project with the text "hello world" inside. Do not create any other files.';

async function main(): Promise<void> {
  const repoDir = process.cwd();
  const git = simpleGit(repoDir);
  let baseBranch = 'main';
  try {
    const branchSummary = await git.branchLocal();
    baseBranch = branchSummary.current;
  } catch {}

  process.stderr.write(`\n=== E2E Test: Real Copilot CLI ===\n`);
  process.stderr.write(`Repo: ${repoDir}\nBase branch: ${baseBranch}\nPrompt: ${PROMPT}\n\n`);

  const orch = new Orchestrator({ repoDir, baseBranch });
  await orch.init();

  const tasks: AgentTask[] = [{ id: 'e2etest', prompt: PROMPT }];

  process.stderr.write(`[1/5] Launching agent...\n`);
  await orch.launch(tasks);

  process.stderr.write(`[2/5] Waiting for agent to finish...\n`);
  const results = await orch.waitForAll();
  const result = results[0]!;
  process.stderr.write(`\n[3/5] Result: status=${result.status}, stopReason=${result.stopReason ?? 'N/A'}, error=${result.error ?? 'none'}\n`);

  if (result.status === 'error') {
    process.stderr.write(`\nFAIL — Agent errored: ${result.error}\n`);
    await orch.shutdown();
    process.exit(1);
  }

  // Inspect worktree BEFORE shutdown
  process.stderr.write(`\n[4/5] Inspecting worktree...\n`);
  const wt = orch.worktrees[0]!;
  process.stderr.write(`  Path: ${wt.path}\n  Branch: ${wt.branch}\n`);

  let passed = false;
  if (fs.existsSync(wt.path)) {
    const files = fs.readdirSync(wt.path);
    process.stderr.write(`  Files: ${files.join(', ')}\n`);

    const indexPath = path.join(wt.path, 'index.txt');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      process.stderr.write(`  index.txt content: "${content.trim()}"\n`);
      passed = content.toLowerCase().includes('hello world');
      process.stderr.write(passed ? `\nPASS — index.txt with correct content\n` : `\nFAIL — wrong content\n`);
    } else {
      process.stderr.write(`  index.txt NOT FOUND in root\n`);
      const found = findFile(wt.path, 'index.txt', 3);
      if (found) {
        const content = fs.readFileSync(found, 'utf-8');
        process.stderr.write(`  Found at: ${found}\n  Content: "${content.trim()}"\n`);
      }
    }

    const wtGit = simpleGit(wt.path);
    const status = await wtGit.status();
    process.stderr.write(`\n  Git status:\n`);
    process.stderr.write(`    Modified: ${status.modified.join(', ') || 'none'}\n`);
    process.stderr.write(`    Created: ${status.created.join(', ') || 'none'}\n`);
    process.stderr.write(`    Not added: ${status.not_added.join(', ') || 'none'}\n`);
    try {
      const log = await wtGit.log({ maxCount: 3 });
      process.stderr.write(`\n  Recent commits on ${wt.branch}:\n`);
      for (const e of log.all) process.stderr.write(`    ${e.hash.slice(0, 7)} ${e.message}\n`);
    } catch {}
  } else {
    process.stderr.write(`  Worktree directory does NOT exist!\n`);
  }

  process.stderr.write(`\n[5/5] Cleaning up...\n`);
  await orch.shutdown();
  const stillExists = fs.existsSync(wt.path);
  process.stderr.write(`  Worktree exists after cleanup: ${stillExists}\n`);
  process.stderr.write(`\n=== Test complete ===\n`);
  process.exit(passed ? 0 : 1);
}

function findFile(dir: string, name: string, depth: number): string | null {
  if (depth <= 0) return null;
  try {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === name && e.isFile()) return path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const f = findFile(path.join(dir, e.name), name, depth - 1);
        if (f) return f;
      }
    }
  } catch {}
  return null;
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
