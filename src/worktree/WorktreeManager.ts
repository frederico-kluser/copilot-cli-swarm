import { simpleGit, type SimpleGit } from 'simple-git';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../logging/logger.js';

export interface WorktreeInfo {
  id: string;
  path: string;
  branch: string;
}

export class DirtyWorktreeError extends Error {
  constructor(wtPath: string) {
    super(`Worktree is dirty: ${wtPath}`);
    this.name = 'DirtyWorktreeError';
  }
}

const VALID_ID = /^[a-z0-9-]+$/;

export class WorktreeManager {
  private readonly git: SimpleGit;
  private readonly repoDir: string;
  private readonly managed: Map<string, WorktreeInfo> = new Map();

  constructor(repoDir: string) {
    this.repoDir = path.resolve(repoDir);
    this.git = simpleGit(this.repoDir);
  }

  private worktreeBase(): string {
    return path.join(os.tmpdir(), 'copilot-orch');
  }

  private worktreePath(id: string): string {
    return path.join(this.worktreeBase(), `agent-${id}`);
  }

  async create(opts: { id: string; baseBranch: string }): Promise<WorktreeInfo> {
    if (!VALID_ID.test(opts.id)) {
      throw new Error(`ID inválido "${opts.id}": só [a-z0-9-] permitido`);
    }

    if (this.managed.has(opts.id)) {
      throw new Error(`Worktree com id "${opts.id}" já existe`);
    }

    const wtPath = this.worktreePath(opts.id);
    const branch = `agent/${opts.id}`;

    fs.mkdirSync(this.worktreeBase(), { recursive: true });

    await this.git.raw(['worktree', 'add', wtPath, '-b', branch, opts.baseBranch]);

    const info: WorktreeInfo = { id: opts.id, path: wtPath, branch };
    this.managed.set(opts.id, info);
    return info;
  }

  async list(): Promise<WorktreeInfo[]> {
    const raw = await this.git.raw(['worktree', 'list', '--porcelain']);
    const entries: WorktreeInfo[] = [];

    for (const block of raw.split('\n\n')) {
      const lines = block.trim().split('\n');
      const wtLine = lines.find((l) => l.startsWith('worktree '));
      const branchLine = lines.find((l) => l.startsWith('branch '));

      if (!wtLine) continue;
      const wtPath = wtLine.replace('worktree ', '');

      // Skip main worktree
      if (wtPath === this.repoDir) continue;

      const branch = branchLine ? branchLine.replace('branch refs/heads/', '') : '';
      const id = path.basename(wtPath).replace('agent-', '');

      entries.push({ id, path: wtPath, branch });
    }

    return entries;
  }

  async destroy(info: WorktreeInfo, opts?: { force?: boolean }): Promise<void> {
    // Guard: never destroy main worktree
    if (path.resolve(info.path) === this.repoDir) {
      throw new Error('Recusando destruir a worktree principal');
    }

    try {
      const wtGit = simpleGit(info.path);
      const status = await wtGit.status();

      if (!status.isClean() && !opts?.force) {
        throw new DirtyWorktreeError(info.path);
      }

      if (!status.isClean() && opts?.force) {
        await wtGit.raw(['checkout', '--', '.']);
        await wtGit.clean('f', ['-d']);
      }
    } catch (err) {
      if (err instanceof DirtyWorktreeError) throw err;
      // worktree path might already be gone
    }

    try {
      await this.git.raw(['worktree', 'remove', '--force', info.path]);
    } catch {
      // already removed
    }

    try {
      await this.git.raw(['branch', '-D', info.branch]);
    } catch {
      // branch already gone
    }

    this.managed.delete(info.id);
  }

  async destroyAll(): Promise<void> {
    const entries = await this.list();
    for (const entry of entries) {
      try {
        await this.destroy(entry, { force: true });
      } catch (err) {
        logger.warn({ err, worktree: entry.id }, 'Failed to destroy worktree');
      }
    }
    // Also destroy any in managed that weren't listed
    for (const [, info] of this.managed) {
      try {
        await this.destroy(info, { force: true });
      } catch {
        // ignore
      }
    }
    try {
      await this.git.raw(['worktree', 'prune']);
    } catch {
      // ignore
    }
    this.managed.clear();
  }

  async isLocked(wtPath: string): Promise<boolean> {
    const name = path.basename(wtPath);
    const lockFile = path.join(this.repoDir, '.git', 'worktrees', name, 'locked');
    try {
      fs.accessSync(lockFile);
      return true;
    } catch {
      return false;
    }
  }

  async pruneOrphans(): Promise<number> {
    const entries = await this.list();
    let pruned = 0;
    const base = this.worktreeBase();

    for (const entry of entries) {
      if (!entry.path.startsWith(base)) continue;

      const exists = fs.existsSync(entry.path);
      if (!exists) {
        // Reference exists but path is gone
        try {
          await this.git.raw(['worktree', 'prune']);
        } catch {
          // ignore
        }
        pruned++;
        continue;
      }

      // Check if locked
      const locked = await this.isLocked(entry.path);
      if (locked) {
        try {
          await this.git.raw(['worktree', 'unlock', entry.path]);
        } catch {
          // ignore
        }
      }

      try {
        await this.destroy(entry, { force: true });
        pruned++;
      } catch (err) {
        logger.warn({ err, path: entry.path }, 'Failed to prune orphan worktree');
      }
    }

    // Also clean up dirs on disk that aren't in git worktree list
    if (fs.existsSync(base)) {
      const dirs = fs.readdirSync(base);
      const listedPaths = new Set(entries.map((e) => e.path));
      for (const dir of dirs) {
        if (!dir.startsWith('agent-')) continue;
        const fullPath = path.join(base, dir);
        if (!listedPaths.has(fullPath)) {
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
            pruned++;
          } catch {
            // ignore
          }
        }
      }
    }

    if (pruned > 0) {
      try {
        await this.git.raw(['worktree', 'prune']);
      } catch {
        // ignore
      }
    }

    return pruned;
  }
}
