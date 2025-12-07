/**
 * LLMSectionRenderer - Renders LLM settings (provider, model, thinking)
 *
 * Uses the shared LLMSettingsPicker component for consistent UI.
 * Replaces separate ModelSectionRenderer and ThinkingSectionRenderer.
 */

import { ISectionRenderer, ChatSettingsState, ChatSettingsDependencies } from './types';
import { LLMSettingsPicker, LLMSelection } from '../../../../components/shared/LLMSettingsPicker';
import { getNexusPlugin } from '../../../../utils/pluginLocator';

export class LLMSectionRenderer implements ISectionRenderer {
  private picker: LLMSettingsPicker | null = null;
  private containerEl: HTMLElement | null = null;

  constructor(
    private state: ChatSettingsState,
    private deps: ChatSettingsDependencies
  ) {}

  render(container: HTMLElement): void {
    this.containerEl = container.createDiv('llm-settings-section');

    // Get LLM provider settings from plugin
    const plugin = getNexusPlugin(this.deps.app) as any;
    const llmProviderSettings = plugin?.settings?.settings?.llmProviders;

    if (!llmProviderSettings) {
      this.containerEl.createEl('p', {
        text: 'LLM settings not available',
        cls: 'setting-item-description'
      });
      return;
    }

    // Determine initial selection from state
    const initialSelection: Partial<LLMSelection> = {
      provider: this.state.selectedModel?.providerId || llmProviderSettings.defaultModel?.provider || '',
      model: this.state.selectedModel?.modelId || llmProviderSettings.defaultModel?.model || '',
      thinking: this.state.thinking
    };

    // Create picker
    this.picker = new LLMSettingsPicker(this.containerEl, {
      app: this.deps.app,
      llmProviderSettings,
      initialSelection,
      callbacks: {
        onProviderChange: (provider) => {
          // Provider changed - model will also change via onModelChange
        },
        onModelChange: (provider, model) => {
          // Find the full model option from available models
          const modelOption = this.state.availableModels.find(
            m => m.providerId === provider && m.modelId === model
          );
          if (modelOption) {
            this.state.selectedModel = modelOption;
            this.deps.onModelChange?.(modelOption);
          }
        },
        onThinkingChange: (settings) => {
          this.state.thinking = settings;
          this.deps.onThinkingChange?.(settings);
        }
      }
    });

    this.picker.render();
  }

  update(): void {
    if (this.picker && this.state.selectedModel) {
      this.picker.setSelection({
        provider: this.state.selectedModel.providerId,
        model: this.state.selectedModel.modelId,
        thinking: this.state.thinking
      });
    }
  }

  destroy(): void {
    this.picker = null;
    this.containerEl = null;
  }
}
