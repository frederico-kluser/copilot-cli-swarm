#!/usr/bin/env tsx
// Standalone fake ACP stream — emits NDJSON to stdout simulating a Copilot CLI ACP session.
// Usage: npx tsx src/mock/fake-acp-stream.ts [--scenario=error]

const scenario = process.argv.includes('--scenario=error') ? 'error' : 'happy';

function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run(): Promise<void> {
  // t=0: initialize response
  emit({
    jsonrpc: '2.0',
    id: 1,
    result: { protocolVersion: 1, agentCapabilities: {} },
  });

  await sleep(100);

  // t=100: session/new response
  emit({
    jsonrpc: '2.0',
    id: 2,
    result: { sessionId: 'mock_sess_1' },
  });

  await sleep(400);

  // t=500: agent_thought_chunk
  emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'mock_sess_1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { text: 'Analisando a estrutura do repositório...' },
      },
    },
  });

  await sleep(500);

  emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'mock_sess_1',
      update: {
        sessionUpdate: 'agent_thought_chunk',
        content: { text: ' Identificando arquivos relevantes.' },
      },
    },
  });

  await sleep(500);

  // t=1500: plan
  emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'mock_sess_1',
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Read directory structure', priority: 'high', status: 'pending' },
          { content: 'Analyze file contents', priority: 'high', status: 'pending' },
          { content: 'Generate summary', priority: 'medium', status: 'pending' },
        ],
      },
    },
  });

  await sleep(1000);

  // t=2500: tool_call
  emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'mock_sess_1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc_1',
        title: 'Execute command',
        kind: 'execute',
        rawInput: { command: 'ls -la' },
      },
    },
  });

  await sleep(1500);

  if (scenario === 'error') {
    // Emit tool_call_update failed
    emit({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'mock_sess_1',
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tc_1',
          status: 'failed',
          error: 'Permission denied',
        },
      },
    });
    process.exit(1);
  }

  // t=4000: tool_call_update completed
  emit({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'mock_sess_1',
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc_1',
        status: 'completed',
      },
    },
  });

  await sleep(500);

  // t=4500: 20 agent_message_chunks at ~150ms intervals
  const words = [
    'The repository ', 'contains several ', 'TypeScript files ', 'organized in ',
    'a modular ', 'structure. ', 'The main ', 'entry point ', 'is located ', 'at ',
    'src/index.ts. ', 'The project ', 'uses ESM ', 'modules with ', 'strict ',
    'TypeScript ', 'configuration. ', 'Tests are ', 'powered by ', 'Vitest.',
  ];

  for (const word of words) {
    emit({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'mock_sess_1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: word },
        },
      },
    });
    await sleep(150);
  }

  await sleep(500);

  // Final response for session/prompt
  emit({
    jsonrpc: '2.0',
    id: 3,
    result: { stopReason: 'end_turn' },
  });
}

run().catch((err) => {
  process.stderr.write(`Error: ${String(err)}\n`);
  process.exit(1);
});
