import { afterEach, describe, expect, it } from 'vitest';
import { AgentSupervisor } from '../AgentSupervisor.js';

const supervisors: AgentSupervisor[] = [];

afterEach(async () => {
  await Promise.allSettled(supervisors.splice(0).map((supervisor) => supervisor.shutdown()));
});

describe('AgentSupervisor model selection', () => {
  it('discovers available models during session setup', async () => {
    const supervisor = new AgentSupervisor({
      id: 'agent-a',
      cwd: process.cwd(),
      mock: true,
      model: 'claude-sonnet-4',
    });
    supervisors.push(supervisor);

    await supervisor.start();

    expect(supervisor.getCurrentModel()).toBe('claude-sonnet-4');
    expect(supervisor.state.currentModelLabel).toBe('Claude Sonnet 4');
    expect(supervisor.getAvailableModels().map((model) => model.value)).toContain('gpt-5');
  });

  it('switches model through session/set_config_option', async () => {
    const supervisor = new AgentSupervisor({
      id: 'agent-b',
      cwd: process.cwd(),
      mock: true,
    });
    supervisors.push(supervisor);

    await supervisor.start();
    await supervisor.setModel('gpt-5-mini');

    expect(supervisor.getCurrentModel()).toBe('gpt-5-mini');
    expect(supervisor.state.currentModelLabel).toBe('GPT-5 mini');
  });

  it('rejects unknown model ids', async () => {
    const supervisor = new AgentSupervisor({
      id: 'agent-c',
      cwd: process.cwd(),
      mock: true,
    });
    supervisors.push(supervisor);

    await supervisor.start();

    await expect(supervisor.setModel('does-not-exist')).rejects.toThrow('Unknown model');
  });
});