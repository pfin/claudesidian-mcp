/**
 * LLMSettingsPicker - Reusable provider/model/thinking picker
 *
 * Used by both DefaultsTab (main settings) and ChatSettingsModal.
 * Provides consistent UI for selecting LLM provider, model, and thinking settings.
 */

import { App, Setting } from 'obsidian';
import { LLMProviderManager } from '../../services/llm/providers/ProviderManager';
import { StaticModelsService } from '../../services/StaticModelsService';
import { LLMProviderSettings, ThinkingEffort } from '../../types/llm/ProviderTypes';

/**
 * Thinking settings structure
 */
export interface ThinkingSettings {
  enabled: boolean;
  effort: ThinkingEffort;
}

/**
 * Current selection state
 */
export interface LLMSelection {
  provider: string;
  model: string;
  thinking: ThinkingSettings;
}

/**
 * Callbacks for selection changes
 */
export interface LLMSettingsPickerCallbacks {
  onProviderChange?: (provider: string) => void;
  onModelChange?: (provider: string, model: string) => void;
  onThinkingChange?: (settings: ThinkingSettings) => void;
}

/**
 * Options for the picker
 */
export interface LLMSettingsPickerOptions {
  app: App;
  llmProviderSettings: LLMProviderSettings;
  initialSelection?: Partial<LLMSelection>;
  callbacks?: LLMSettingsPickerCallbacks;
  showThinking?: boolean; // Default true
}

/**
 * Provider display names
 */
const PROVIDER_NAMES: Record<string, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google AI',
  mistral: 'Mistral AI',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  requesty: 'Requesty',
  perplexity: 'Perplexity'
};

/**
 * Effort level constants
 */
const EFFORT_LEVELS: ThinkingEffort[] = ['low', 'medium', 'high'];
const EFFORT_LABELS: Record<ThinkingEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

export class LLMSettingsPicker {
  private container: HTMLElement;
  private options: LLMSettingsPickerOptions;
  private providerManager: LLMProviderManager;
  private staticModelsService: StaticModelsService;

  // Current state
  private currentProvider: string;
  private currentModel: string;
  private currentThinking: ThinkingSettings;

  // UI references
  private thinkingContainer?: HTMLElement;
  private effortContainer?: HTMLElement;

  constructor(container: HTMLElement, options: LLMSettingsPickerOptions) {
    this.container = container;
    this.options = options;
    this.staticModelsService = StaticModelsService.getInstance();

    // Initialize provider manager
    this.providerManager = new LLMProviderManager(
      options.llmProviderSettings,
      undefined,
      options.app.vault
    );

    // Set initial state
    this.currentProvider = options.initialSelection?.provider ||
      options.llmProviderSettings.defaultModel?.provider || '';
    this.currentModel = options.initialSelection?.model ||
      options.llmProviderSettings.defaultModel?.model || '';
    this.currentThinking = options.initialSelection?.thinking || {
      enabled: false,
      effort: 'medium'
    };
  }

  /**
   * Render the picker UI
   */
  render(): void {
    this.container.empty();

    this.renderProviderDropdown();
    this.renderModelDropdown();

    if (this.options.showThinking !== false) {
      this.renderThinkingSection();
    }
  }

  /**
   * Get enabled providers
   */
  private getEnabledProviders(): string[] {
    const settings = this.options.llmProviderSettings;
    return Object.keys(settings.providers).filter(id => {
      const config = settings.providers[id];
      if (!config?.enabled) return false;
      return !!config.apiKey || id === 'ollama' || id === 'lmstudio';
    });
  }

  /**
   * Render provider dropdown
   */
  private renderProviderDropdown(): void {
    new Setting(this.container)
      .setName('Provider')
      .setDesc('Select the LLM provider')
      .addDropdown(dropdown => {
        const enabledProviders = this.getEnabledProviders();

        if (enabledProviders.length === 0) {
          dropdown.addOption('', 'No providers enabled');
        } else {
          enabledProviders.forEach(providerId => {
            dropdown.addOption(providerId, PROVIDER_NAMES[providerId] || providerId);
          });
        }

        dropdown.setValue(this.currentProvider);
        dropdown.onChange(async (value) => {
          this.currentProvider = value;
          this.currentModel = await this.getDefaultModelForProvider(value);
          this.options.callbacks?.onProviderChange?.(value);
          this.options.callbacks?.onModelChange?.(value, this.currentModel);
          this.render(); // Re-render to update model dropdown
        });
      });
  }

  /**
   * Render model dropdown
   */
  private renderModelDropdown(): void {
    const providerId = this.currentProvider;

    // Special handling for Ollama - just show current model
    if (providerId === 'ollama') {
      new Setting(this.container)
        .setName('Model')
        .setDesc('Configure model in Ollama provider settings')
        .addText(text => text
          .setValue(this.currentModel || '')
          .setDisabled(true)
          .setPlaceholder('Configure in Ollama settings'));
      return;
    }

    new Setting(this.container)
      .setName('Model')
      .setDesc('Select the specific model')
      .addDropdown(async dropdown => {
        if (!providerId) {
          dropdown.addOption('', 'Select a provider first');
          return;
        }

        try {
          const models = await this.providerManager.getModelsForProvider(providerId);

          if (models.length === 0) {
            dropdown.addOption('', 'No models available');
          } else {
            models.forEach(model => {
              dropdown.addOption(model.id, model.name);
            });

            // Set current value or default to first
            const exists = models.some(m => m.id === this.currentModel);
            if (exists) {
              dropdown.setValue(this.currentModel);
            } else if (models.length > 0) {
              this.currentModel = models[0].id;
              dropdown.setValue(this.currentModel);
            }
          }

          dropdown.onChange((value) => {
            this.currentModel = value;
            this.options.callbacks?.onModelChange?.(this.currentProvider, value);
            this.updateThinkingVisibility();
          });
        } catch (error) {
          dropdown.addOption('', 'Error loading models');
        }
      });
  }

  /**
   * Render thinking settings section
   */
  private renderThinkingSection(): void {
    this.thinkingContainer = this.container.createDiv('llm-thinking-section');

    const supportsThinking = this.checkModelSupportsThinking();

    if (!supportsThinking) {
      this.thinkingContainer.addClass('is-hidden');
      return;
    }

    // Effort slider container (hidden when thinking disabled)
    this.effortContainer = this.thinkingContainer.createDiv('llm-thinking-effort-container');
    if (!this.currentThinking.enabled) {
      this.effortContainer.addClass('is-hidden');
    }

    // Effort slider - shows before the toggle
    new Setting(this.effortContainer)
      .setName('Effort')
      .addSlider(slider => slider
        .setLimits(0, 2, 1)
        .setValue(EFFORT_LEVELS.indexOf(this.currentThinking.effort))
        .setDynamicTooltip()
        .onChange(value => {
          this.currentThinking.effort = EFFORT_LEVELS[value];
          this.options.callbacks?.onThinkingChange?.(this.currentThinking);
        }));

    // Toggle for enabling thinking
    new Setting(this.thinkingContainer)
      .setName('Reasoning')
      .setDesc('Let the model think step-by-step before responding')
      .addToggle(toggle => toggle
        .setValue(this.currentThinking.enabled)
        .onChange((value) => {
          this.currentThinking.enabled = value;
          this.options.callbacks?.onThinkingChange?.(this.currentThinking);
          this.updateEffortVisibility();
        }));
  }

  /**
   * Check if current model supports thinking
   */
  private checkModelSupportsThinking(): boolean {
    if (!this.currentProvider || !this.currentModel) return false;

    const model = this.staticModelsService.findModel(this.currentProvider, this.currentModel);
    return model?.capabilities?.supportsThinking ?? false;
  }

  /**
   * Update thinking section visibility
   */
  private updateThinkingVisibility(): void {
    if (!this.thinkingContainer) return;

    const supportsThinking = this.checkModelSupportsThinking();
    if (supportsThinking) {
      this.thinkingContainer.removeClass('is-hidden');
    } else {
      this.thinkingContainer.addClass('is-hidden');
    }
  }

  /**
   * Update effort pills visibility
   */
  private updateEffortVisibility(): void {
    if (!this.effortContainer) return;

    if (this.currentThinking.enabled) {
      this.effortContainer.removeClass('is-hidden');
    } else {
      this.effortContainer.addClass('is-hidden');
    }
  }

  /**
   * Get default model for provider
   */
  private async getDefaultModelForProvider(providerId: string): Promise<string> {
    if (providerId === 'ollama') {
      return this.options.llmProviderSettings.providers.ollama?.ollamaModel || '';
    }

    try {
      const models = await this.providerManager.getModelsForProvider(providerId);
      return models[0]?.id || '';
    } catch {
      return '';
    }
  }

  /**
   * Get current selection
   */
  getSelection(): LLMSelection {
    return {
      provider: this.currentProvider,
      model: this.currentModel,
      thinking: { ...this.currentThinking }
    };
  }

  /**
   * Update selection externally
   */
  setSelection(selection: Partial<LLMSelection>): void {
    if (selection.provider !== undefined) this.currentProvider = selection.provider;
    if (selection.model !== undefined) this.currentModel = selection.model;
    if (selection.thinking !== undefined) this.currentThinking = { ...selection.thinking };
    this.render();
  }
}
