import React from 'react';
import { render } from 'ink';
import { expandPromptsForAgents, parseCli, printHelp } from './cli.js';
import { AgentSupervisor } from './agent/AgentSupervisor.js';
import { Orchestrator, type AgentTask } from './orchestrator/Orchestrator.js';
import { App } from './ui/App.js';
import { logger, logFilePath } from './logging/logger.js';
import { readPids, clearAll, isProcessAlive } from './agent/pids-file.js';

async function reapStalePids(): Promise<void> {
  const stale = await readPids();
  for (const entry of stale) {
    const parentAlive = isProcessAlive(entry.parentPid);
    if (!parentAlive && isProcessAlive(entry.pid)) {
      try {
        process.kill(entry.pid, 'SIGKILL');
        logger.warn({ event: 'zombie_reaped', pid: entry.pid, agentId: entry.agentId }, 'Reaped zombie');
      } catch { /* ignore */ }
    }
  }
  await clearAll();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function printAvailableModels(parsed: ReturnType<typeof parseCli>, repoDir: string): Promise<number> {
  const supervisor = new AgentSupervisor({
    id: 'model-list',
    cwd: repoDir,
    model: parsed.model,
    mock: parsed.mock,
    mockScenario: parsed.mockScenario,
  });

  try {
    await supervisor.start();
    const models = supervisor.getAvailableModels();

    if (models.length === 0) {
      process.stderr.write('Nenhum modelo foi exposto pelo agente atual.\n');
      return 1;
    }

    process.stdout.write('Available models:\n');
    for (const model of models) {
      const marker = model.value === supervisor.getCurrentModel() ? '*' : ' ';
      const description = model.description ? ` - ${model.description}` : '';
      process.stdout.write(`${marker} ${model.value} (${model.name})${description}\n`);
    }

    return 0;
  } finally {
    await supervisor.shutdown();
  }
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseCli(process.argv);
  } catch (err) {
    process.stderr.write(`Erro: ${(err as Error).message}\n`);
    process.exit(1);
  }

  if (parsed.help) {
    printHelp();
    process.exit(0);
  }

  process.env['COPILOT_ORCH_LOG_LEVEL'] = parsed.logLevel;

  logger.info({
    event: 'start',
    agents: parsed.agents,
    listModels: parsed.listModels,
    model: parsed.model,
    mock: parsed.mock,
    prompts: parsed.prompts.length,
    logFile: logFilePath,
  }, 'Starting orchestrator');

  // Reap stale PIDs from previous crashes
  await reapStalePids();

  const repoDir = process.cwd();

  if (parsed.listModels) {
    process.exit(await printAvailableModels(parsed, repoDir));
  }

  // Detect default branch
  const { simpleGit } = await import('simple-git');
  const git = simpleGit(repoDir);
  let baseBranch = 'main';
  try {
    const branchSummary = await git.branchLocal();
    baseBranch = branchSummary.current;
  } catch { /* ignore */ }

  const orch = new Orchestrator({
    repoDir,
    baseBranch,
    model: parsed.model,
    mock: parsed.mock,
    mockScenario: parsed.mockScenario,
  });

  await orch.init();

  // Build tasks: 1 prompt replicates to all agents; many prompts use round-robin
  const expandedPrompts = expandPromptsForAgents(parsed.prompts, parsed.agents);
  const tasks: AgentTask[] = expandedPrompts.map((prompt) => ({
    id: Math.random().toString(36).slice(2, 8),
    prompt,
  }));

  const startedAt = Date.now();

  // Render UI BEFORE launch so user sees agents spawning in real-time
  const inkInstance = render(
    React.createElement(App, {
      orchestrator: orch,
      startedAt,
    }),
    { exitOnCtrlC: false },
  );

  // Shutdown handler
  let shuttingDown = false;
  const shutdown = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) return;
    shuttingDown = true;

    try { inkInstance.unmount(); } catch { /* ignore */ }

    process.stderr.write(`\n[${signal}] shutting down ${orch.supervisors.length} agents...\n`);

    await orch.shutdown();

    process.exit(signal === 'SIGINT' ? 130 : 143);
  };

  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });

  // Launch agents (UI updates in real-time via agentAdded + stateChange events)
  await orch.launch(tasks);

  // Wait for all agents to finish
  const results = await orch.waitForAll();

  logger.info({ event: 'all_done', results }, 'All agents finished');

  // Wait a moment for UI to show final states
  await sleep(2000);

  try { inkInstance.unmount(); } catch { /* ignore */ }

  // Preserve worktrees on normal completion so user can inspect results
  await orch.shutdown({ preserveWorktrees: true });

  const errors = results.filter((r) => r.status === 'error');
  if (errors.length > 0) {
    process.stderr.write(`\n${errors.length} agent(s) failed:\n`);
    for (const e of errors) {
      process.stderr.write(`  ${e.id}: ${e.error}\n`);
    }
  }

  // Show worktree paths so user knows where to find results
  if (orch.worktrees.length > 0) {
    process.stderr.write(`\nWorktrees (preserved):\n`);
    for (const wt of orch.worktrees) {
      process.stderr.write(`  ${wt.id}: ${wt.path}\n`);
    }
    process.stderr.write(`Run 'npm run cleanup' to remove worktrees when done.\n`);
  }

  process.stderr.write(`\nlogs: ${logFilePath}\n`);
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
