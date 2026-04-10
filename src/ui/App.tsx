import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { Orchestrator } from '../orchestrator/Orchestrator.js';
import { AgentGrid } from './AgentGrid.js';
import { StatusBar, Footer } from './StatusBar.js';
import { useOrchestratorSupervisors } from './useOrchestratorSupervisors.js';
import { useOrchestratorModelState } from './useOrchestratorModelState.js';
import { WizardScreen } from './wizard/WizardScreen.js';
import type { WizardConfig } from './wizard/types.js';

interface AppProps {
  orchestrator: Orchestrator;
  startedAt: number;
  interactive?: boolean;
  onLaunch?: (config: WizardConfig) => void;
}

export function App({ orchestrator, startedAt, interactive, onLaunch }: AppProps) {
  const [mode, setMode] = useState<'wizard' | 'running'>(interactive ? 'wizard' : 'running');
  const supervisors = useOrchestratorSupervisors(orchestrator);
  const modelState = useOrchestratorModelState(orchestrator);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  useEffect(() => {
    if (mode !== 'running') return;

    if (modelState.availableModels.length === 0) {
      setHighlightedIndex(0);
      setSelectorOpen(false);
      return;
    }

    const currentIndex = modelState.availableModels.findIndex(
      (model) => model.value === modelState.selectedModel,
    );

    if (currentIndex >= 0) {
      setHighlightedIndex(currentIndex);
      return;
    }

    setHighlightedIndex((index) => Math.min(index, modelState.availableModels.length - 1));
  }, [mode, modelState.availableModels, modelState.selectedModel]);

  useInput((input, key) => {
    if (mode !== 'running') return;

    if (key.ctrl && input === 'c') {
      return;
    }

    if ((input === 'm' || input === 'M') && modelState.availableModels.length > 0 && !modelState.switching) {
      setSelectorOpen((open) => !open);
      return;
    }

    if (!selectorOpen) {
      return;
    }

    if (key.escape) {
      setSelectorOpen(false);
      return;
    }

    if (key.upArrow || input === 'k') {
      setHighlightedIndex((index) => {
        const lastIndex = modelState.availableModels.length - 1;
        return index <= 0 ? lastIndex : index - 1;
      });
      return;
    }

    if (key.downArrow || input === 'j') {
      setHighlightedIndex((index) => (index + 1) % modelState.availableModels.length);
      return;
    }

    if (key.return) {
      const selectedModel = modelState.availableModels[highlightedIndex];
      if (!selectedModel) {
        return;
      }

      setSelectorOpen(false);
      void orchestrator.setModelForAll(selectedModel.value).catch(() => undefined);
    }
  });

  // Wizard mode
  if (mode === 'wizard') {
    return (
      <WizardScreen
        onComplete={(config) => {
          setMode('running');
          onLaunch?.(config);
        }}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <StatusBar
        supervisors={supervisors}
        startedAt={startedAt}
        modelState={modelState}
        selectorOpen={selectorOpen}
      />

      {selectorOpen && modelState.availableModels.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={modelState.switching ? 'yellow' : 'cyan'}
          paddingX={1}
          marginBottom={1}
        >
          <Text bold>Model selector</Text>
          {modelState.availableModels.map((model, index) => (
            <Text key={model.value} color={index === highlightedIndex ? 'cyan' : undefined}>
              {index === highlightedIndex ? '>' : ' '} {model.name}
              {model.value === modelState.selectedModel ? ' (current)' : ''}
              {model.description ? ` - ${model.description}` : ''}
            </Text>
          ))}
        </Box>
      )}

      <AgentGrid supervisors={supervisors} />
      <Footer />
    </Box>
  );
}
