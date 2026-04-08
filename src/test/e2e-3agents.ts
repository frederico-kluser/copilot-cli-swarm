/**
 * E2E test — 3 real Copilot agents in parallel
 *
 * Spawna 3 agentes reais, cada um na sua worktree,
 * cada um criando index.txt com "hello world".
 * Inspeciona todas as worktrees e faz cleanup.
 *
 * Usage: npx tsx src/test/e2e-3agents.ts
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

  const w = (msg: string) => process.stderr.write(msg);

  w(`\n=== E2E Test: 3 Real Copilot Agents in Parallel ===\n`);
  w(`Repo: ${repoDir}\nBase branch: ${baseBranch}\n\n`);

  const orch = new Orchestrator({ repoDir, baseBranch });
  await orch.init();

  const tasks: AgentTask[] = [
    { id: 'agent-a', prompt: PROMPT },
    { id: 'agent-b', prompt: PROMPT },
    { id: 'agent-c', prompt: PROMPT },
  ];

  w(`[1/4] Launching 3 agents (with 2s stagger)...\n`);
  await orch.launch(tasks);

  w(`[2/4] Waiting for all agents to finish...\n`);
  const results = await orch.waitForAll();

  w(`\n[3/4] Results & Worktree Inspection:\n`);
  w(`${'─'.repeat(60)}\n`);

  let allPassed = true;

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const wt = orch.worktrees[i];

    w(`\n  Agent ${result.id}:\n`);
    w(`    Status: ${result.status}\n`);
    w(`    Stop reason: ${result.stopReason ?? 'N/A'}\n`);

    if (result.status === 'error') {
      w(`    Error: ${result.error}\n`);
      allPassed = false;
      continue;
    }

    if (!wt) {
      w(`    Worktree: NOT FOUND\n`);
      allPassed = false;
      continue;
    }

    w(`    Worktree: ${wt.path}\n`);
    w(`    Branch: ${wt.branch}\n`);

    if (!fs.existsSync(wt.path)) {
      w(`    Directory: DOES NOT EXIST\n`);
      allPassed = false;
      continue;
    }

    const files = fs.readdirSync(wt.path);
    w(`    Files: ${files.filter(f => !f.startsWith('.')).join(', ')}\n`);

    const indexPath = path.join(wt.path, 'index.txt');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const hasHelloWorld = content.toLowerCase().includes('hello world');
      w(`    index.txt: "${content.trim()}"\n`);
      w(`    Verdict: ${hasHelloWorld ? 'PASS' : 'FAIL (wrong content)'}\n`);
      if (!hasHelloWorld) allPassed = false;
    } else {
      w(`    index.txt: NOT FOUND\n`);
      const found = findFile(wt.path, 'index.txt', 3);
      if (found) {
        const content = fs.readFileSync(found, 'utf-8');
        w(`    Found elsewhere: ${found}\n`);
        w(`    Content: "${content.trim()}"\n`);
      }
      allPassed = false;
    }

    // Git status
    const wtGit = simpleGit(wt.path);
    const status = await wtGit.status();
    w(`    Git not_added: ${status.not_added.join(', ') || 'none'}\n`);
  }

  w(`\n${'─'.repeat(60)}\n`);
  w(`\n[4/4] Cleaning up all worktrees...\n`);
  await orch.shutdown();

  // Verify cleanup
  for (const wt of orch.worktrees) {
    const exists = fs.existsSync(wt.path);
    w(`  ${wt.id}: exists after cleanup = ${exists}\n`);
  }

  w(`\n${'═'.repeat(60)}\n`);
  w(allPassed
    ? `  ALL 3 AGENTS PASSED\n`
    : `  SOME AGENTS FAILED\n`);
  w(`${'═'.repeat(60)}\n\n`);

  process.exit(allPassed ? 0 : 1);
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
