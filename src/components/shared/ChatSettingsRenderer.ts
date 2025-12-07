/**
 * ChatSettingsRenderer - Shared settings UI for DefaultsTab and ChatSettingsModal
 *
 * Renders identical UI in both places:
 * - Provider dropdown
 * - Model dropdown
 * - Thinking toggle + effort slider
 * - Image model settings
 * - Workspace dropdown
 * - Agent dropdown
 * - Context notes (file picker)
 *
 * The difference is only WHERE data is saved (via callbacks).
 */

import { App, Setting } from 'obsidian';
import { LLMProviderManager } from '../../services/llm/providers/ProviderManager';
import { StaticModelsService } from '../../services/StaticModelsService';
import { LLMProviderSettings, ThinkingEffort } from '../../types/llm/ProviderTypes';
import { FilePickerRenderer } from '../workspace/FilePickerRenderer';

/**
 * Current settings state
 */
export interface ChatSettings {
  provider: string;
  model: string;
  thinking: {
    enabled: boolean;
    effort: ThinkingEffort;
  };
  imageProvider: 'google' | 'openrouter';
  imageModel: string;
  workspaceId: string | null;
  agentId: string | null;
  contextNotes: string[];
}

/**
 * Available options for dropdowns
 */
export interface ChatSettingsOptions {
  workspaces: Array<{ id: string; name: string }>;
  agents: Array<{ id: string; name: string }>;
}

/**
 * Callbacks for when settings change
 */
export interface ChatSettingsCallbacks {
  onSettingsChange: (settings: ChatSettings) => void;
}

/**
 * Renderer configuration
 */
export interface ChatSettingsRendererConfig {
  app: App;
  llmProviderSettings: LLMProviderSettings;
  initialSettings: ChatSettings;
  options: ChatSettingsOptions;
  callbacks: ChatSettingsCallbacks;
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
 * Effort levels
 */
const EFFORT_LEVELS: ThinkingEffort[] = ['low', 'medium', 'high'];
const EFFORT_LABELS: Record<ThinkingEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High'
};

/**
 * Image models by provider
 */
const IMAGE_MODELS: Record<string, Array<{ id: string; name: string }>> = {
  google: [
    { id: 'gemini-2.5-flash-image', name: 'Nano Banana (Fast)' },
    { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro (Advanced)' }
  ],
  openrouter: [
    { id: 'gemini-2.5-flash-image', name: 'Nano Banana (Fast)' },
    { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro (Advanced)' },
    { id: 'flux-2-pro', name: 'FLUX.2 Pro' },
    { id: 'flux-2-flex', name: 'FLUX.2 Flex' }
  ]
};

export class ChatSettingsRenderer {
  private container: HTMLElement;
  private config: ChatSettingsRendererConfig;
  private providerManager: LLMProviderManager;
  private staticModelsService: StaticModelsService;

  // Current state
  private settings: ChatSettings;

  // UI references
  private thinkingContainer?: HTMLElement;
  private effortContainer?: HTMLElement;
  private contextNotesListEl?: HTMLElement;

  constructor(container: HTMLElement, config: ChatSettingsRendererConfig) {
    this.container = container;
    this.config = config;
    this.settings = { ...config.initialSettings };
    this.staticModelsService = StaticModelsService.getInstance();

    this.providerManager = new LLMProviderManager(
      config.llmProviderSettings,
      undefined,
      config.app.vault
    );
  }

  /**
   * Render the full settings UI
   */
  render(): void {
    this.container.empty();

    // LLM Section
    this.renderLLMSection();

    // Context Section
    this.renderContextSection();
  }

  /**
   * Notify of settings change
   */
  private notifyChange(): void {
    this.config.callbacks.onSettingsChange({ ...this.settings });
  }

  /**
   * Get enabled providers
   */
  private getEnabledProviders(): string[] {
    const llmSettings = this.config.llmProviderSettings;
    return Object.keys(llmSettings.providers).filter(id => {
      const config = llmSettings.providers[id];
      if (!config?.enabled) return false;
      return !!config.apiKey || id === 'ollama' || id === 'lmstudio';
    });
  }

  // ========== LLM SECTION ==========

  private renderLLMSection(): void {
    const section = this.container.createDiv('chat-settings-section');
    section.createEl('h4', { text: 'Model' });

    this.renderProviderDropdown(section);
    this.renderModelDropdown(section);
    this.renderThinkingSection(section);
    this.renderImageSection(section);
  }

  private renderProviderDropdown(container: HTMLElement): void {
    new Setting(container)
      .setName('Provider')
      .addDropdown(dropdown => {
        const providers = this.getEnabledProviders();

        if (providers.length === 0) {
          dropdown.addOption('', 'No providers enabled');
        } else {
          providers.forEach(id => {
            dropdown.addOption(id, PROVIDER_NAMES[id] || id);
          });
        }

        dropdown.setValue(this.settings.provider);
        dropdown.onChange(async (value) => {
          this.settings.provider = value;
          this.settings.model = await this.getDefaultModelForProvider(value);
          this.notifyChange();
          this.render(); // Re-render to update model dropdown
        });
      });
  }

  private renderModelDropdown(container: HTMLElement): void {
    const providerId = this.settings.provider;

    // Ollama - show as text
    if (providerId === 'ollama') {
      new Setting(container)
        .setName('Model')
        .addText(text => text
          .setValue(this.settings.model || '')
          .setDisabled(true)
          .setPlaceholder('Configure in Ollama settings'));
      return;
    }

    new Setting(container)
      .setName('Model')
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

            const exists = models.some(m => m.id === this.settings.model);
            if (exists) {
              dropdown.setValue(this.settings.model);
            } else if (models.length > 0) {
              this.settings.model = models[0].id;
              dropdown.setValue(this.settings.model);
              this.notifyChange();
            }
          }

          dropdown.onChange((value) => {
            this.settings.model = value;
            this.notifyChange();
            this.updateThinkingVisibility();
          });
        } catch {
          dropdown.addOption('', 'Error loading models');
        }
      });
  }

  private renderThinkingSection(container: HTMLElement): void {
    this.thinkingContainer = container.createDiv('chat-settings-thinking');

    const supportsThinking = this.checkModelSupportsThinking();
    if (!supportsThinking) {
      this.thinkingContainer.addClass('is-hidden');
      return;
    }

    // Effort slider (hidden when thinking disabled)
    this.effortContainer = this.thinkingContainer.createDiv('chat-settings-effort');
    if (!this.settings.thinking.enabled) {
      this.effortContainer.addClass('is-hidden');
    }

    new Setting(this.effortContainer)
      .setName('Effort')
      .addSlider(slider => slider
        .setLimits(0, 2, 1)
        .setValue(EFFORT_LEVELS.indexOf(this.settings.thinking.effort))
        .setDynamicTooltip()
        .onChange(value => {
          this.settings.thinking.effort = EFFORT_LEVELS[value];
          this.notifyChange();
        }));

    // Toggle
    new Setting(this.thinkingContainer)
      .setName('Reasoning')
      .setDesc('Think step-by-step before responding')
      .addToggle(toggle => toggle
        .setValue(this.settings.thinking.enabled)
        .onChange(value => {
          this.settings.thinking.enabled = value;
          this.notifyChange();
          this.updateEffortVisibility();
        }));
  }

  private renderImageSection(container: HTMLElement): void {
    const imageSection = container.createDiv('chat-settings-image');
    imageSection.createEl('h5', { text: 'Image Generation' });

    // Image provider
    new Setting(imageSection)
      .setName('Image Provider')
      .addDropdown(dropdown => {
        const imageProviders = [
          { id: 'google', name: 'Google AI' },
          { id: 'openrouter', name: 'OpenRouter' }
        ];

        imageProviders.forEach(p => {
          dropdown.addOption(p.id, p.name);
        });

        dropdown.setValue(this.settings.imageProvider);
        dropdown.onChange((value) => {
          this.settings.imageProvider = value as 'google' | 'openrouter';
          this.settings.imageModel = IMAGE_MODELS[value]?.[0]?.id || '';
          this.notifyChange();
          this.render();
        });
      });

    // Image model
    const models = IMAGE_MODELS[this.settings.imageProvider] || [];
    new Setting(imageSection)
      .setName('Image Model')
      .addDropdown(dropdown => {
        models.forEach(m => {
          dropdown.addOption(m.id, m.name);
        });

        const exists = models.some(m => m.id === this.settings.imageModel);
        if (exists) {
          dropdown.setValue(this.settings.imageModel);
        } else if (models.length > 0) {
          this.settings.imageModel = models[0].id;
          dropdown.setValue(this.settings.imageModel);
        }

        dropdown.onChange((value) => {
          this.settings.imageModel = value;
          this.notifyChange();
        });
      });
  }

  // ========== CONTEXT SECTION ==========

  private renderContextSection(): void {
    const section = this.container.createDiv('chat-settings-section');
    section.createEl('h4', { text: 'Context' });

    this.renderWorkspaceDropdown(section);
    this.renderAgentDropdown(section);
    this.renderContextNotes(section);
  }

  private renderWorkspaceDropdown(container: HTMLElement): void {
    new Setting(container)
      .setName('Workspace')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'None');

        this.config.options.workspaces.forEach(w => {
          dropdown.addOption(w.id, w.name);
        });

        dropdown.setValue(this.settings.workspaceId || '');
        dropdown.onChange((value) => {
          this.settings.workspaceId = value || null;
          this.notifyChange();

          // Auto-select workspace's dedicated agent if it has one
          this.syncWorkspaceAgent(value);
        });
      });
  }

  private async syncWorkspaceAgent(workspaceId: string | null): Promise<void> {
    if (!workspaceId) return;

    // Find the workspace and check for dedicated agent
    const workspace = this.config.options.workspaces.find(w => w.id === workspaceId);
    if (workspace && (workspace as any).context?.dedicatedAgent?.agentId) {
      const agentId = (workspace as any).context.dedicatedAgent.agentId;
      const agent = this.config.options.agents.find(a => a.id === agentId || a.name === agentId);
      if (agent) {
        this.settings.agentId = agent.id || agent.name;
        this.notifyChange();
        this.render(); // Re-render to update agent dropdown
      }
    }
  }

  private renderAgentDropdown(container: HTMLElement): void {
    new Setting(container)
      .setName('Agent')
      .addDropdown(dropdown => {
        dropdown.addOption('', 'None');

        this.config.options.agents.forEach(a => {
          dropdown.addOption(a.name, a.name);
        });

        dropdown.setValue(this.settings.agentId || '');
        dropdown.onChange((value) => {
          this.settings.agentId = value || null;
          this.notifyChange();
        });
      });
  }

  private renderContextNotes(container: HTMLElement): void {
    const notesSection = container.createDiv('chat-settings-context-notes');

    new Setting(notesSection)
      .setName('Context Notes')
      .setDesc('Files to include in the system prompt')
      .addButton(button => button
        .setButtonText('Add')
        .onClick(() => this.openNotePicker()));

    this.contextNotesListEl = notesSection.createDiv('context-notes-list');
    this.renderContextNotesList();
  }

  private renderContextNotesList(): void {
    if (!this.contextNotesListEl) return;
    this.contextNotesListEl.empty();

    if (this.settings.contextNotes.length === 0) {
      this.contextNotesListEl.createEl('p', {
        text: 'No context notes added',
        cls: 'setting-item-description'
      });
      return;
    }

    this.settings.contextNotes.forEach((notePath, index) => {
      new Setting(this.contextNotesListEl!)
        .setName(notePath)
        .addButton(button => button
          .setButtonText('Remove')
          .setClass('mod-warning')
          .onClick(() => {
            this.settings.contextNotes.splice(index, 1);
            this.notifyChange();
            this.renderContextNotesList();
          }));
    });
  }

  private async openNotePicker(): Promise<void> {
    const selectedPaths = await FilePickerRenderer.openModal(this.config.app, {
      title: 'Select Context Notes',
      excludePaths: this.settings.contextNotes
    });

    if (selectedPaths.length > 0) {
      this.settings.contextNotes.push(...selectedPaths);
      this.notifyChange();
      this.renderContextNotesList();
    }
  }

  // ========== HELPERS ==========

  private async getDefaultModelForProvider(providerId: string): Promise<string> {
    if (providerId === 'ollama') {
      return this.config.llmProviderSettings.providers.ollama?.ollamaModel || '';
    }

    try {
      const models = await this.providerManager.getModelsForProvider(providerId);
      return models[0]?.id || '';
    } catch {
      return '';
    }
  }

  private checkModelSupportsThinking(): boolean {
    if (!this.settings.provider || !this.settings.model) return false;

    const model = this.staticModelsService.findModel(this.settings.provider, this.settings.model);
    return model?.capabilities?.supportsThinking ?? false;
  }

  private updateThinkingVisibility(): void {
    if (!this.thinkingContainer) return;

    if (this.checkModelSupportsThinking()) {
      this.thinkingContainer.removeClass('is-hidden');
    } else {
      this.thinkingContainer.addClass('is-hidden');
    }
  }

  private updateEffortVisibility(): void {
    if (!this.effortContainer) return;

    if (this.settings.thinking.enabled) {
      this.effortContainer.removeClass('is-hidden');
    } else {
      this.effortContainer.addClass('is-hidden');
    }
  }

  /**
   * Get current settings
   */
  getSettings(): ChatSettings {
    return { ...this.settings };
  }
}
