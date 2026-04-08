import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput, ConfirmInput } from '@inkjs/ui';
import type { WizardConfig, AgentConfig, WizardStep } from './types.js';
import { DEFAULT_MODELS } from './types.js';

interface WizardScreenProps {
  onComplete: (config: WizardConfig) => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Custom arrow-key selector — replaces @inkjs/ui Select which has bugs with empty values */
function ArrowSelect({ options, onSelect }: {
  options: { label: string; value: string; description?: string }[];
  onSelect: (value: string) => void;
}) {
  const [focused, setFocused] = useState(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setFocused((i) => (i <= 0 ? options.length - 1 : i - 1));
    }
    if (key.downArrow) {
      setFocused((i) => (i >= options.length - 1 ? 0 : i + 1));
    }
    if (key.return) {
      const opt = options[focused];
      if (opt) {
        onSelect(opt.value);
      }
    }
  });

  return (
    <Box flexDirection="column">
      {options.map((opt, i) => (
        <Text key={opt.value} color={i === focused ? 'cyan' : undefined} bold={i === focused}>
          {i === focused ? '> ' : '  '}{opt.label}{opt.description ? ` — ${opt.description}` : ''}
        </Text>
      ))}
    </Box>
  );
}

export function WizardScreen({ onComplete }: WizardScreenProps) {
  const [step, setStep] = useState<WizardStep>('agents_count');
  const [agentCount, setAgentCount] = useState(1);
  const [globalModel, setGlobalModel] = useState('auto');
  const [sharedPrompt, setSharedPrompt] = useState(true);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [modelOverrides, setModelOverrides] = useState<(string | undefined)[]>([]);
  const [overrideIndex, setOverrideIndex] = useState(0);
  const [wantOverrides, setWantOverrides] = useState<boolean | null>(null);

  const modelLabel = useCallback((value: string) => {
    const m = DEFAULT_MODELS.find((mod) => mod.value === value);
    return m ? m.label : value;
  }, []);

  // Step: agents_count
  if (step === 'agents_count') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Box marginTop={1}>
          <Text>Numero de agentes (1-6): </Text>
          <TextInput
            placeholder="1"
            onSubmit={(value) => {
              const n = parseInt(value || '1', 10);
              if (n >= 1 && n <= 6) {
                setAgentCount(n);
                setPrompts([]);
                setModelOverrides(Array.from({ length: n }, () => undefined));
                setStep('model_select');
              }
            }}
          />
        </Box>
        <Text dimColor>Maximo 6 agentes. Pressione Enter para confirmar.</Text>
      </Box>
    );
  }

  // Step: model_select
  if (step === 'model_select') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Text dimColor>Agentes: {agentCount}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Selecione o modelo global:</Text>
          <Text dimColor>Use setas para navegar, Enter para confirmar</Text>
          <Box marginTop={1}>
            <ArrowSelect
              options={DEFAULT_MODELS}
              onSelect={(value) => {
                setGlobalModel(value);
                setStep('prompt_mode');
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Step: prompt_mode
  if (step === 'prompt_mode') {
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Text dimColor>Agentes: {agentCount} | Modelo: {modelLabel(globalModel)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Usar o mesmo prompt para todos os agentes?</Text>
          <Box marginTop={1}>
            <ConfirmInput
              defaultChoice="confirm"
              onConfirm={() => {
                setSharedPrompt(true);
                setCurrentPromptIndex(0);
                setPrompts([]);
                setStep('prompts');
              }}
              onCancel={() => {
                setSharedPrompt(false);
                setCurrentPromptIndex(0);
                setPrompts([]);
                setStep('prompts');
              }}
            />
          </Box>
          <Text dimColor>Y = prompt unico | N = prompt individual por agente</Text>
        </Box>
      </Box>
    );
  }

  // Step: prompts
  if (step === 'prompts') {
    const totalNeeded = sharedPrompt ? 1 : agentCount;
    const label = sharedPrompt
      ? 'Prompt (para todos os agentes):'
      : `Prompt do Agente ${currentPromptIndex + 1}/${agentCount}:`;

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Text dimColor>Agentes: {agentCount} | Modelo: {modelLabel(globalModel)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>{label}</Text>
          {prompts.map((p, i) => (
            <Text key={i} color="green">  {'✓'} Agente {i + 1}: {p}</Text>
          ))}
          <Box marginTop={1}>
            <Text color="yellow">{'> '}</Text>
            <TextInput
              key={`prompt-${currentPromptIndex}`}
              placeholder="Digite o prompt e pressione Enter..."
              onSubmit={(value) => {
                if (!value.trim()) return;
                const newPrompts = [...prompts, value.trim()];
                setPrompts(newPrompts);

                if (newPrompts.length >= totalNeeded) {
                  if (agentCount > 1) {
                    setWantOverrides(null);
                    setStep('model_overrides');
                  } else {
                    setStep('review');
                  }
                } else {
                  setCurrentPromptIndex(currentPromptIndex + 1);
                }
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Step: model_overrides
  if (step === 'model_overrides') {
    if (wantOverrides === null) {
      return (
        <Box flexDirection="column" paddingX={1} paddingY={1}>
          <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
          <Text dimColor>{'─'.repeat(40)}</Text>
          <Text dimColor>Agentes: {agentCount} | Modelo: {modelLabel(globalModel)}</Text>
          <Box marginTop={1} flexDirection="column">
            <Text bold>Customizar modelo por agente?</Text>
            <Box marginTop={1}>
              <ConfirmInput
                defaultChoice="cancel"
                onConfirm={() => {
                  setWantOverrides(true);
                  setOverrideIndex(0);
                }}
                onCancel={() => {
                  setWantOverrides(false);
                  setStep('review');
                }}
              />
            </Box>
            <Text dimColor>N = usar modelo global para todos</Text>
          </Box>
        </Box>
      );
    }

    const agentPrompt = sharedPrompt ? prompts[0]! : prompts[overrideIndex]!;
    const overrideOptions = [
      { label: `Global (${modelLabel(globalModel)})`, value: 'global' },
      ...DEFAULT_MODELS.filter((m) => m.value !== globalModel),
    ];

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Text dimColor>Agentes: {agentCount} | Modelo global: {modelLabel(globalModel)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Modelo do Agente {overrideIndex + 1}/{agentCount}:</Text>
          <Text dimColor>  Prompt: {agentPrompt.slice(0, 60)}{agentPrompt.length > 60 ? '...' : ''}</Text>
          {modelOverrides.slice(0, overrideIndex).map((m, i) => (
            <Text key={i} color="green">  {'✓'} Agente {i + 1}: {m ? modelLabel(m) : modelLabel(globalModel)}</Text>
          ))}
          <Box marginTop={1}>
            <ArrowSelect
              key={`override-${overrideIndex}`}
              options={overrideOptions}
              onSelect={(value) => {
                const newOverrides = [...modelOverrides];
                newOverrides[overrideIndex] = value === 'global' ? undefined : value;
                setModelOverrides(newOverrides);

                if (overrideIndex + 1 >= agentCount) {
                  setStep('review');
                } else {
                  setOverrideIndex(overrideIndex + 1);
                }
              }}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Step: review
  if (step === 'review') {
    const configs = buildAgentConfigs();
    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Multi-Copilot Orchestrator — Setup</Text>
        <Text dimColor>{'─'.repeat(40)}</Text>
        <Box marginTop={1} flexDirection="column">
          <Text bold>Resumo da configuracao:</Text>
          <Text>  Agentes: <Text color="cyan">{agentCount}</Text></Text>
          <Text>  Modelo global: <Text color="cyan">{modelLabel(globalModel)}</Text></Text>
          <Box marginTop={1} flexDirection="column">
            {configs.map((c, i) => (
              <Box key={c.id} flexDirection="column" marginBottom={1}>
                <Text bold>  Agente {i + 1} <Text dimColor>({c.id})</Text></Text>
                <Text>    Prompt: <Text color="green">{c.prompt.slice(0, 70)}{c.prompt.length > 70 ? '...' : ''}</Text></Text>
                <Text>    Modelo: <Text color="cyan">{modelLabel(c.model || globalModel)}</Text></Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text bold>Lancar agentes?</Text>
            <Box marginTop={1}>
              <ConfirmInput
                defaultChoice="confirm"
                onConfirm={() => {
                  onComplete({
                    agents: agentCount,
                    model: globalModel === 'auto' ? '' : globalModel,
                    agentConfigs: configs,
                  });
                }}
                onCancel={() => {
                  setStep('agents_count');
                  setPrompts([]);
                  setModelOverrides([]);
                  setCurrentPromptIndex(0);
                  setOverrideIndex(0);
                  setWantOverrides(null);
                }}
              />
            </Box>
            <Text dimColor>Y = iniciar | N = recomecar configuracao</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return null;

  function buildAgentConfigs(): AgentConfig[] {
    return Array.from({ length: agentCount }, (_, i) => ({
      id: generateId(),
      prompt: sharedPrompt ? prompts[0]! : prompts[i]!,
      model: modelOverrides[i] || undefined,
    }));
  }
}
