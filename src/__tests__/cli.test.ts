import { describe, expect, it } from 'vitest';
import { expandPromptsForAgents, parseCli } from '../cli.js';

describe('parseCli', () => {
  it('accepts a single prompt with -n 4', () => {
    const result = parseCli(['node', 'cli', '-n', '4', 'same prompt']);

    expect(result.agents).toBe(4);
    expect(result.prompts).toEqual(['same prompt']);
  });
});

describe('expandPromptsForAgents', () => {
  it('replicates a single prompt to all agents', () => {
    expect(expandPromptsForAgents(['same prompt'], 4)).toEqual([
      'same prompt',
      'same prompt',
      'same prompt',
      'same prompt',
    ]);
  });

  it('preserves round-robin for multiple prompts', () => {
    expect(expandPromptsForAgents(['a', 'b'], 4)).toEqual(['a', 'b', 'a', 'b']);
  });
});