import { AgentSupervisor, type AgentSupervisorOptions } from '../agent/AgentSupervisor.js';
import { WorktreeManager, type WorktreeInfo } from '../worktree/WorktreeManager.js';
import { logger } from '../logging/logger.js';
import type { MockScenario } from '../mock/MockCopilotProcess.js';

export interface OrchestratorOptions {
  repoDir: string;
  baseBranch?: string;
  spawnStaggerMs?: number;
  mock?: boolean;
  mockScenario?: MockScenario;
}

export interface AgentTask {
  id: string;
  prompt: string;
}

export interface PromptResult {
  id: string;
  status: 'done' | 'error';
  stopReason?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 8);
}

export class Orchestrator {
  readonly supervisors: AgentSupervisor[] = [];
  readonly worktrees: WorktreeInfo[] = [];
  readonly wm: WorktreeManager;
  private readonly opts: OrchestratorOptions;
  private readonly spawnStaggerMs: number;
  private promptTrackers: Map<string, {
    resolve: (result: PromptResult) => void;
    promise: Promise<PromptResult>;
  }> = new Map();

  constructor(opts: OrchestratorOptions) {
    this.opts = opts;
    this.wm = new WorktreeManager(opts.repoDir);
    this.spawnStaggerMs = opts.spawnStaggerMs
      ?? (process.env['COPILOT_ORCH_STAGGER_MS']
        ? parseInt(process.env['COPILOT_ORCH_STAGGER_MS'], 10)
        : 2000);
  }

  async init(): Promise<void> {
    const pruned = await this.wm.pruneOrphans();
    if (pruned > 0) {
      logger.warn({ event: 'orphans_cleaned', count: pruned }, `Cleaned ${pruned} orphan worktrees`);
    }
  }

  async launch(tasks: AgentTask[]): Promise<void> {
    if (tasks.length > 6) {
      throw new Error('N > 6 não suportado; use no máximo 6 agentes');
    }

    if (tasks.length > 3 && this.spawnStaggerMs < 3000) {
      logger.warn(
        { event: 'high_n_low_stagger', n: tasks.length, stagger: this.spawnStaggerMs },
        'N alto com stagger baixo; considere stagger >= 3000ms',
      );
    }

    const baseBranch = this.opts.baseBranch ?? 'main';

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]!;
      const id = task.id || generateId();

      logger.info(
        { event: 'spawn', id, index: i, spawnAt: new Date().toISOString() },
        `Spawning agent ${id}`,
      );

      let wt: WorktreeInfo;
      try {
        wt = await this.wm.create({ id, baseBranch });
      } catch (err) {
        logger.error({ err, id }, 'Failed to create worktree, skipping task');
        // Track as error
        const tracker = this.createTracker(id);
        tracker.resolve({ id, status: 'error', error: `worktree failed: ${(err as Error).message}` });
        continue;
      }
      this.worktrees.push(wt);

      const supervisorOpts: AgentSupervisorOptions = {
        id,
        cwd: wt.path,
        mock: this.opts.mock,
        mockScenario: this.opts.mockScenario,
      };

      const supervisor = new AgentSupervisor(supervisorOpts);
      this.supervisors.push(supervisor);

      // Prevent unhandled 'error' event crash — errors are tracked via promise
      supervisor.on('error', (err) => {
        logger.error({ err, id }, 'Agent error event');
      });

      try {
        await supervisor.start();
      } catch (err) {
        logger.error({ err, id }, 'Failed to start agent');
        const tracker = this.createTracker(id);
        tracker.resolve({ id, status: 'error', error: `start failed: ${(err as Error).message}` });
        continue;
      }

      // Fire prompt without awaiting
      const tracker = this.createTracker(id);
      supervisor
        .prompt(task.prompt)
        .then((stopReason) => {
          tracker.resolve({ id, status: 'done', stopReason });
        })
        .catch((err: Error) => {
          tracker.resolve({ id, status: 'error', error: err.message });
        });

      // Stagger between spawns (except last)
      if (i < tasks.length - 1) {
        await sleep(this.spawnStaggerMs);
      }
    }
  }

  private createTracker(id: string) {
    let resolve!: (result: PromptResult) => void;
    const promise = new Promise<PromptResult>((r) => { resolve = r; });
    const tracker = { resolve, promise };
    this.promptTrackers.set(id, tracker);
    return tracker;
  }

  async waitForAll(): Promise<PromptResult[]> {
    const promises = Array.from(this.promptTrackers.values()).map((t) => t.promise);
    return Promise.all(promises);
  }

  async shutdown(opts?: { preserveWorktrees?: boolean }): Promise<void> {
    // Cancel all
    await Promise.allSettled(this.supervisors.map((s) => s.cancel()));

    // Wait a bit for graceful termination
    await Promise.race([
      Promise.allSettled(this.supervisors.map((s) => s.waitForExit())),
      sleep(3000),
    ]);

    // Force shutdown
    await Promise.allSettled(this.supervisors.map((s) => s.shutdown()));

    // Destroy worktrees unless explicitly preserved
    if (!opts?.preserveWorktrees) {
      await this.wm.destroyAll();
    }

    logger.info(
      { event: 'orchestrator_shutdown', preserveWorktrees: opts?.preserveWorktrees ?? false },
      'Orchestrator shut down',
    );
  }
}
