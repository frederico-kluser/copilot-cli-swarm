import { EventEmitter } from 'node:events';
import { AgentSupervisor, type AgentSupervisorOptions } from '../agent/AgentSupervisor.js';
import { WorktreeManager, type WorktreeInfo } from '../worktree/WorktreeManager.js';
import { logger } from '../logging/logger.js';
import type { MockScenario } from '../mock/MockCopilotProcess.js';
import type { SessionConfigValue } from '../acp/types.js';

export interface OrchestratorOptions {
  repoDir: string;
  baseBranch?: string;
  spawnStaggerMs?: number;
  model?: string;
  mock?: boolean;
  mockScenario?: MockScenario;
}

export interface AgentTask {
  id: string;
  prompt: string;
  model?: string;
}

export interface PromptResult {
  id: string;
  status: 'done' | 'error';
  stopReason?: string;
  error?: string;
}

export interface OrchestratorModelState {
  availableModels: SessionConfigValue[];
  selectedModel: string | null;
  selectedModelLabel: string | null;
  switching: boolean;
  error: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function mergeAvailableModels(supervisors: AgentSupervisor[]): SessionConfigValue[] {
  const seen = new Set<string>();
  const merged: SessionConfigValue[] = [];

  for (const supervisor of supervisors) {
    for (const model of supervisor.getAvailableModels()) {
      if (seen.has(model.value)) {
        continue;
      }

      seen.add(model.value);
      merged.push(model);
    }
  }

  return merged;
}

export class Orchestrator extends EventEmitter {
  readonly supervisors: AgentSupervisor[] = [];
  readonly worktrees: WorktreeInfo[] = [];
  readonly wm: WorktreeManager;
  private readonly opts: OrchestratorOptions;
  private readonly spawnStaggerMs: number;
  private modelState: OrchestratorModelState;
  private promptTrackers: Map<string, {
    resolve: (result: PromptResult) => void;
    promise: Promise<PromptResult>;
  }> = new Map();

  constructor(opts: OrchestratorOptions) {
    super();
    this.opts = opts;
    this.wm = new WorktreeManager(opts.repoDir);
    this.spawnStaggerMs = opts.spawnStaggerMs
      ?? (process.env['COPILOT_ORCH_STAGGER_MS']
        ? parseInt(process.env['COPILOT_ORCH_STAGGER_MS'], 10)
        : 500);
    this.modelState = {
      availableModels: [],
      selectedModel: opts.model ?? null,
      selectedModelLabel: opts.model ?? null,
      switching: false,
      error: null,
    };
  }

  getModelState(): OrchestratorModelState {
    return this.modelState;
  }

  private setModelState(nextState: OrchestratorModelState): void {
    const changed = JSON.stringify(this.modelState) !== JSON.stringify(nextState);
    this.modelState = nextState;
    if (changed) {
      this.emit('modelStateChange', this.modelState);
    }
  }

  private refreshModelState(): void {
    const discoveredModels = mergeAvailableModels(this.supervisors);
    const availableModels = discoveredModels.length > 0
      ? discoveredModels
      : this.modelState.availableModels;

    const supervisorsWithModelInfo = this.supervisors.filter(
      (supervisor) => supervisor.getAvailableModels().length > 0 || supervisor.getCurrentModel() !== null,
    );
    const currentModels = [...new Set(
      supervisorsWithModelInfo
        .map((supervisor) => supervisor.getCurrentModel())
        .filter((model): model is string => model !== null),
    )];

    let selectedModel = this.modelState.selectedModel;
    if (currentModels.length === 1 && (!selectedModel || !this.modelState.switching)) {
      selectedModel = currentModels[0]!;
    }

    const selectedModelLabel = selectedModel
      ? availableModels.find((model) => model.value === selectedModel)?.name
        ?? supervisorsWithModelInfo.find((supervisor) => supervisor.getCurrentModel() === selectedModel)?.state.currentModelLabel
        ?? this.modelState.selectedModelLabel
        ?? selectedModel
      : null;

    const switching = this.modelState.switching && selectedModel !== null
      ? supervisorsWithModelInfo.some((supervisor) => supervisor.getCurrentModel() !== selectedModel)
      : false;

    this.setModelState({
      availableModels,
      selectedModel,
      selectedModelLabel,
      switching,
      error: this.modelState.error,
    });
  }

  async setModelForAll(model: string): Promise<void> {
    const knownModels = this.modelState.availableModels;
    if (knownModels.length > 0 && !knownModels.some((option) => option.value === model)) {
      throw new Error(`Unknown model: ${model}`);
    }

    const selectedModelLabel = knownModels.find((option) => option.value === model)?.name ?? model;
    const activeSupervisors = this.supervisors.filter(
      (supervisor) => supervisor.getAvailableModels().length > 0 || supervisor.getCurrentModel() !== null,
    );

    this.setModelState({
      ...this.modelState,
      selectedModel: model,
      selectedModelLabel,
      switching: activeSupervisors.length > 0,
      error: null,
    });

    if (activeSupervisors.length === 0) {
      return;
    }

    const results = await Promise.allSettled(activeSupervisors.map((supervisor) => supervisor.setModel(model)));
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

    this.refreshModelState();

    if (failures.length > 0) {
      this.setModelState({
        ...this.modelState,
        switching: false,
        error: failures[0] ?? 'Model switch failed',
      });
      throw new Error(failures[0] ?? 'Model switch failed');
    }

    this.setModelState({
      ...this.modelState,
      switching: false,
      error: null,
    });
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

    // Phase 1: Create worktrees and instantiate supervisors (sequential, fast I/O)
    const prepared: { supervisor: AgentSupervisor; task: AgentTask; id: string }[] = [];

    for (const task of tasks) {
      const id = task.id || generateId();

      logger.info(
        { event: 'spawn', id, spawnAt: new Date().toISOString() },
        `Spawning agent ${id}`,
      );

      let wt: WorktreeInfo;
      try {
        wt = await this.wm.create({ id, baseBranch });
      } catch (err) {
        logger.error({ err, id }, 'Failed to create worktree, skipping task');
        const tracker = this.createTracker(id);
        tracker.resolve({ id, status: 'error', error: `worktree failed: ${(err as Error).message}` });
        continue;
      }
      this.worktrees.push(wt);

      const supervisorOpts: AgentSupervisorOptions = {
        id,
        cwd: wt.path,
        model: task.model ?? this.modelState.selectedModel ?? undefined,
        mock: this.opts.mock,
        mockScenario: this.opts.mockScenario,
      };

      const supervisor = new AgentSupervisor(supervisorOpts);
      this.supervisors.push(supervisor);

      supervisor.on('stateChange', () => {
        this.refreshModelState();
      });

      this.refreshModelState();

      // Notify UI immediately so agents appear as "spawning"
      this.emit('agentAdded', supervisor);

      // Prevent unhandled 'error' event crash — errors are tracked via promise
      supervisor.on('error', (err) => {
        logger.error({ err, id }, 'Agent error event');
      });

      prepared.push({ supervisor, task, id });
    }

    // Phase 2: Start all supervisors with minimal stagger (ACP handshake)
    const startPromises: Promise<{ supervisor: AgentSupervisor; task: AgentTask; id: string } | null>[] = [];

    for (let i = 0; i < prepared.length; i++) {
      const entry = prepared[i]!;

      const startPromise = (async () => {
        if (i > 0) {
          await sleep(this.spawnStaggerMs);
        }
        try {
          await entry.supervisor.start();
          return entry;
        } catch (err) {
          logger.error({ err, id: entry.id }, 'Failed to start agent');
          const tracker = this.createTracker(entry.id);
          tracker.resolve({ id: entry.id, status: 'error', error: `start failed: ${(err as Error).message}` });
          return null;
        }
      })();

      startPromises.push(startPromise);
    }

    const started = await Promise.all(startPromises);

    // Phase 3: Fire all prompts simultaneously (no stagger)
    for (const entry of started) {
      if (!entry) continue;

      const tracker = this.createTracker(entry.id);
      entry.supervisor
        .prompt(entry.task.prompt)
        .then((stopReason) => {
          tracker.resolve({ id: entry.id, status: 'done', stopReason });
        })
        .catch((err: Error) => {
          tracker.resolve({ id: entry.id, status: 'error', error: err.message });
        });
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
