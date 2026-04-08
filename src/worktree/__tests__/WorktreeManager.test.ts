import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorktreeManager, DirtyWorktreeError } from '../WorktreeManager.js';
import { simpleGit } from 'simple-git';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

let testRepoDir: string;
let wm: WorktreeManager;
let defaultBranch: string;

beforeEach(async () => {
  testRepoDir = path.join(os.tmpdir(), `wt-test-${randomUUID()}`);
  fs.mkdirSync(testRepoDir, { recursive: true });

  const git = simpleGit(testRepoDir);
  await git.init();
  await git.addConfig('user.email', 'test@test.com');
  await git.addConfig('user.name', 'Test');

  fs.writeFileSync(path.join(testRepoDir, 'README.md'), '# test\n');
  await git.add('.');
  await git.commit('initial commit');

  // Detect the default branch name (master or main)
  const branchSummary = await git.branchLocal();
  defaultBranch = branchSummary.current;

  wm = new WorktreeManager(testRepoDir);
});

afterEach(async () => {
  try {
    await wm.destroyAll();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(testRepoDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe('WorktreeManager', () => {
  it('create() produz worktree listável em list()', async () => {
    const info = await wm.create({ id: 'test-1', baseBranch: defaultBranch });
    expect(fs.existsSync(info.path)).toBe(true);

    const listed = await wm.list();
    expect(listed.length).toBe(1);
    expect(listed[0]!.id).toBe('test-1');
  });

  it('create() com id inválido lança erro', async () => {
    await expect(wm.create({ id: 'agent 1', baseBranch: defaultBranch })).rejects.toThrow(
      'ID inválido',
    );
  });

  it('create() duplicado lança erro', async () => {
    await wm.create({ id: 'dup', baseBranch: defaultBranch });
    await expect(wm.create({ id: 'dup', baseBranch: defaultBranch })).rejects.toThrow(
      'já existe',
    );
  });

  it('destroy() em worktree limpa funciona', async () => {
    const info = await wm.create({ id: 'clean', baseBranch: defaultBranch });
    await wm.destroy(info);
    expect(fs.existsSync(info.path)).toBe(false);
  });

  it('destroy() em worktree dirty sem force lança DirtyWorktreeError', async () => {
    const info = await wm.create({ id: 'dirty', baseBranch: defaultBranch });
    fs.writeFileSync(path.join(info.path, 'dirty-file.txt'), 'dirty');

    await expect(wm.destroy(info)).rejects.toThrow(DirtyWorktreeError);
  });

  it('destroy() em worktree dirty com force funciona', async () => {
    const info = await wm.create({ id: 'dirty-force', baseBranch: defaultBranch });
    fs.writeFileSync(path.join(info.path, 'dirty-file.txt'), 'dirty');

    await wm.destroy(info, { force: true });
    expect(fs.existsSync(info.path)).toBe(false);
  });

  it('destroyAll() limpa todas', async () => {
    await wm.create({ id: 'a', baseBranch: defaultBranch });
    await wm.create({ id: 'b', baseBranch: defaultBranch });
    await wm.create({ id: 'c', baseBranch: defaultBranch });

    await wm.destroyAll();

    const listed = await wm.list();
    expect(listed.length).toBe(0);
  });

  it('isLocked() retorna true após criar arquivo locked', async () => {
    const id = `locked-${randomUUID().slice(0, 6)}`;
    const info = await wm.create({ id, baseBranch: defaultBranch });
    const name = path.basename(info.path);
    const lockDir = path.join(testRepoDir, '.git', 'worktrees', name);
    fs.mkdirSync(lockDir, { recursive: true });
    fs.writeFileSync(path.join(lockDir, 'locked'), '');

    const isLocked = await wm.isLocked(info.path);
    expect(isLocked).toBe(true);
  });

  it('list() retorna array vazio após destroyAll', async () => {
    await wm.create({ id: 'x', baseBranch: defaultBranch });
    await wm.destroyAll();

    const listed = await wm.list();
    expect(listed.length).toBe(0);
  });
});
