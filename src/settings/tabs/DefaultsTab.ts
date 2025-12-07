/**
 * DefaultsTab - Default settings for chat (provider, model, workspace, agent)
 *
 * Features:
 * - Default provider/model dropdowns
 * - Default thinking settings (toggle + effort level)
 * - Default image model settings
 * - Default workspace dropdown
 * - Default agent dropdown
 * - Auto-save on all changes
 */

import { App, Setting } from 'obsidian';
import { SettingsRouter } from '../SettingsRouter';
import { LLMProviderSettings, ThinkingEffort } from '../../types/llm/ProviderTypes';
import { LLMProviderManager } from '../../services/llm/providers/ProviderManager';
import { StaticModelsService } from '../../services/StaticModelsService';
import { WEBLLM_MODELS } from '../../services/llm/adapters/webllm/WebLLMModels';
import { Settings } from '../../settings';
import { WorkspaceService } from '../../services/WorkspaceService';
import { CustomPromptStorageService } from '../../agents/agentManager/services/CustomPromptStorageService';
import { CustomPrompt } from '../../types/mcp/CustomPromptTypes';
import { IndividualWorkspace } from '../../types/storage/StorageTypes';

/**
 * Maps slider value (0-2) to effort level
 */
const EFFORT_LEVELS: ThinkingEffort[] = ['low', 'medium', 'high'];
const EFFORT_LABELS: Record<ThinkingEffort, string> = {
    low: 'Low',
    medium: 'Medium',
    high: 'High'
};

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

export interface DefaultsTabServices {
    app: App;
    settings: Settings;
    llmProviderSettings?: LLMProviderSettings;
    workspaceService?: WorkspaceService;
    customPromptStorage?: CustomPromptStorageService;
}

export class DefaultsTab {
    private container: HTMLElement;
    private router: SettingsRouter;
    private services: DefaultsTabServices;
    private providerManager: LLMProviderManager;
    private staticModelsService: StaticModelsService;

    // UI References
    private thinkingContainer?: HTMLElement;

    // Cached data
    private workspaces: IndividualWorkspace[] = [];
    private agents: CustomPrompt[] = [];

    constructor(
        container: HTMLElement,
        router: SettingsRouter,
        services: DefaultsTabServices
    ) {
        this.container = container;
        this.router = router;
        this.services = services;
        this.staticModelsService = StaticModelsService.getInstance();

        // Initialize provider manager
        if (this.services.llmProviderSettings) {
            this.providerManager = new LLMProviderManager(
                this.services.llmProviderSettings,
                undefined,
                this.services.app.vault
            );
        } else {
            this.providerManager = new LLMProviderManager({
                providers: {},
                defaultModel: { provider: '', model: '' }
            }, undefined, this.services.app.vault);
        }

        this.loadDataAndRender();
    }

    /**
     * Load workspaces and agents, then render
     */
    private async loadDataAndRender(): Promise<void> {
        // Load workspaces
        if (this.services.workspaceService) {
            try {
                this.workspaces = await this.services.workspaceService.getAllWorkspaces();
            } catch (error) {
                console.error('[DefaultsTab] Failed to load workspaces:', error);
                this.workspaces = [];
            }
        }

        // Load agents
        if (this.services.customPromptStorage) {
            try {
                this.agents = this.services.customPromptStorage.getAllPrompts();
            } catch (error) {
                console.error('[DefaultsTab] Failed to load agents:', error);
                this.agents = [];
            }
        }

        this.render();
    }

    /**
     * Get current LLM settings
     */
    private getSettings(): LLMProviderSettings {
        return this.services.llmProviderSettings || {
            providers: {},
            defaultModel: { provider: '', model: '' }
        };
    }

    /**
     * Save settings
     */
    private async saveSettings(): Promise<void> {
        if (this.services.settings && this.services.llmProviderSettings) {
            this.services.settings.settings.llmProviders = this.services.llmProviderSettings;
            await this.services.settings.saveSettings();
        }
    }

    /**
     * Main render method
     */
    render(): void {
        this.container.empty();

        const settings = this.getSettings();

        // LLM Defaults section
        this.renderLLMDefaultsSection(settings);

        // Workspace & Agent section
        this.renderContextDefaultsSection();
    }

    /**
     * Render the LLM defaults section (provider, model, thinking, image)
     */
    private renderLLMDefaultsSection(settings: LLMProviderSettings): void {
        const section = this.container.createDiv('nexus-defaults-section');
        section.createEl('h3', { text: 'LLM Defaults' });

        // Default Provider dropdown
        new Setting(section)
            .setName('Default Provider')
            .setDesc('The LLM provider to use when none is specified')
            .addDropdown(dropdown => {
                const enabledProviders = this.getEnabledProviders();

                if (enabledProviders.length === 0) {
                    dropdown.addOption('', 'No providers enabled');
                } else {
                    enabledProviders.forEach(providerId => {
                        dropdown.addOption(providerId, PROVIDER_NAMES[providerId] || providerId);
                    });
                }

                dropdown.setValue(settings.defaultModel.provider);
                dropdown.onChange(async (value) => {
                    settings.defaultModel.provider = value;
                    settings.defaultModel.model = this.getDefaultModelForProvider(value);
                    await this.saveSettings();
                    this.render();
                });
            });

        // Default Model dropdown
        this.renderModelDropdown(section, settings);

        // Default Thinking settings
        this.renderThinkingSection(section, settings);

        // Default Image Model section
        this.renderImageModelSection(section, settings);
    }

    /**
     * Render context defaults section (workspace, agent)
     */
    private renderContextDefaultsSection(): void {
        const section = this.container.createDiv('nexus-defaults-section');
        section.createEl('h3', { text: 'Context Defaults' });

        // Default Workspace dropdown
        new Setting(section)
            .setName('Default Workspace')
            .setDesc('The workspace to load automatically when opening chat')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'None');

                this.workspaces.forEach(workspace => {
                    dropdown.addOption(workspace.id, workspace.name);
                });

                const currentWorkspaceId = this.services.settings.settings.defaultWorkspaceId || '';
                dropdown.setValue(currentWorkspaceId);

                dropdown.onChange(async (value) => {
                    this.services.settings.settings.defaultWorkspaceId = value || undefined;
                    await this.services.settings.saveSettings();
                });
            });

        // Default Agent dropdown
        new Setting(section)
            .setName('Default Agent')
            .setDesc('The custom agent to use automatically when opening chat')
            .addDropdown(dropdown => {
                dropdown.addOption('', 'None');

                this.agents.forEach(agent => {
                    dropdown.addOption(agent.name, agent.name);
                });

                const currentAgentId = this.services.settings.settings.defaultAgentId || '';
                dropdown.setValue(currentAgentId);

                dropdown.onChange(async (value) => {
                    this.services.settings.settings.defaultAgentId = value || undefined;
                    await this.services.settings.saveSettings();
                });
            });
    }

    /**
     * Get a default model for the given provider
     */
    private getDefaultModelForProvider(providerId: string): string {
        if (providerId === 'webllm') {
            return WEBLLM_MODELS[0]?.id || '';
        }

        if (providerId === 'ollama') {
            const settings = this.getSettings();
            return settings.providers.ollama?.ollamaModel || '';
        }

        try {
            const models = this.staticModelsService.getModelsForProvider(providerId);
            return models[0]?.id || '';
        } catch {
            return '';
        }
    }

    /**
     * Get list of enabled provider IDs
     */
    private getEnabledProviders(): string[] {
        const settings = this.getSettings();
        return Object.keys(settings.providers).filter(id => {
            const config = settings.providers[id];
            if (!config?.enabled) return false;
            if (id === 'webllm') return true;
            return !!config.apiKey;
        });
    }

    /**
     * Render the model dropdown
     */
    private renderModelDropdown(container: HTMLElement, settings: LLMProviderSettings): void {
        const providerId = settings.defaultModel.provider;

        // Special handling for Ollama
        if (providerId === 'ollama') {
            new Setting(container)
                .setName('Default Model')
                .setDesc('Configure model in the Ollama provider settings')
                .addText(text => text
                    .setValue(settings.defaultModel.model || '')
                    .setDisabled(true)
                    .setPlaceholder('Configure in Ollama settings'));
            return;
        }

        // Special handling for WebLLM
        if (providerId === 'webllm') {
            new Setting(container)
                .setName('Default Model')
                .setDesc('Local model running in your browser')
                .addDropdown(dropdown => {
                    if (WEBLLM_MODELS.length === 0) {
                        dropdown.addOption('', 'No models available');
                    } else {
                        WEBLLM_MODELS.forEach(model => {
                            dropdown.addOption(model.id, model.name);
                        });
                    }

                    const current = settings.defaultModel.model;
                    const exists = WEBLLM_MODELS.some(m => m.id === current);
                    const selectedModel = exists ? current : (WEBLLM_MODELS[0]?.id || '');
                    dropdown.setValue(selectedModel);

                    if (!exists && selectedModel && settings.defaultModel.model !== selectedModel) {
                        settings.defaultModel.model = selectedModel;
                        this.saveSettings();
                    }

                    dropdown.onChange(async (value) => {
                        settings.defaultModel.model = value;
                        await this.saveSettings();
                        this.updateThinkingVisibility(settings);
                    });
                });
            return;
        }

        // Standard provider models
        new Setting(container)
            .setName('Default Model')
            .setDesc('The specific model to use by default')
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

                        const current = settings.defaultModel.model;
                        const exists = models.some(m => m.id === current);
                        const selectedModel = exists ? current : models[0].id;
                        dropdown.setValue(selectedModel);

                        if (!exists && models.length > 0 && settings.defaultModel.model !== selectedModel) {
                            settings.defaultModel.model = selectedModel;
                            this.saveSettings();
                        }
                    }

                    dropdown.onChange(async (value) => {
                        settings.defaultModel.model = value;
                        await this.saveSettings();
                        this.updateThinkingVisibility(settings);
                    });
                } catch (error) {
                    dropdown.addOption('', 'Error loading models');
                }
            });
    }

    /**
     * Render thinking settings section
     */
    private renderThinkingSection(container: HTMLElement, settings: LLMProviderSettings): void {
        this.thinkingContainer = container.createDiv('nexus-thinking-section');

        const supportsThinking = this.checkModelSupportsThinking(settings);

        if (!supportsThinking) {
            this.thinkingContainer.addClass('is-hidden');
            return;
        }

        if (!settings.defaultThinking) {
            settings.defaultThinking = { enabled: false, effort: 'medium' };
        }

        const effortContainer = this.thinkingContainer.createDiv('nexus-thinking-effort');
        if (!settings.defaultThinking.enabled) {
            effortContainer.addClass('is-hidden');
        }

        const setting = new Setting(this.thinkingContainer)
            .setName('Reasoning')
            .setDesc('Let the model think step-by-step before responding')
            .addToggle(toggle => toggle
                .setValue(settings.defaultThinking?.enabled ?? false)
                .onChange(async (value) => {
                    if (!settings.defaultThinking) {
                        settings.defaultThinking = { enabled: false, effort: 'medium' };
                    }
                    settings.defaultThinking.enabled = value;
                    await this.saveSettings();
                    this.updateEffortVisibility(settings);
                }));

        setting.controlEl.prepend(effortContainer);

        EFFORT_LEVELS.forEach(level => {
            const pill = effortContainer.createEl('button', {
                text: EFFORT_LABELS[level],
                cls: 'nexus-effort-pill'
            });
            if (settings.defaultThinking?.effort === level) {
                pill.addClass('is-active');
            }
            pill.addEventListener('click', async () => {
                if (!settings.defaultThinking) {
                    settings.defaultThinking = { enabled: false, effort: 'medium' };
                }
                settings.defaultThinking.effort = level;
                effortContainer.querySelectorAll('.nexus-effort-pill').forEach(p => p.removeClass('is-active'));
                pill.addClass('is-active');
                await this.saveSettings();
            });
        });
    }

    /**
     * Check if the selected model supports thinking
     */
    private checkModelSupportsThinking(settings: LLMProviderSettings): boolean {
        const providerId = settings.defaultModel.provider;
        const modelId = settings.defaultModel.model;

        if (!providerId || !modelId) return false;

        if (providerId === 'webllm') {
            const model = WEBLLM_MODELS.find(m => m.id === modelId);
            return model?.capabilities?.supportsThinking ?? false;
        }

        const model = this.staticModelsService.findModel(providerId, modelId);
        return model?.capabilities?.supportsThinking ?? false;
    }

    /**
     * Update thinking section visibility
     */
    private updateThinkingVisibility(settings: LLMProviderSettings): void {
        if (!this.thinkingContainer) return;

        const supportsThinking = this.checkModelSupportsThinking(settings);

        if (supportsThinking) {
            this.thinkingContainer.removeClass('is-hidden');
        } else {
            this.thinkingContainer.addClass('is-hidden');
        }
    }

    /**
     * Update effort pills visibility
     */
    private updateEffortVisibility(settings: LLMProviderSettings): void {
        if (!this.thinkingContainer) return;

        const effortContainer = this.thinkingContainer.querySelector('.nexus-thinking-effort');
        if (effortContainer) {
            if (settings.defaultThinking?.enabled) {
                effortContainer.removeClass('is-hidden');
            } else {
                effortContainer.addClass('is-hidden');
            }
        }
    }

    /**
     * Render image model section
     */
    private renderImageModelSection(container: HTMLElement, settings: LLMProviderSettings): void {
        const imageSection = container.createDiv('nexus-image-model-section');
        imageSection.createEl('h4', { text: 'Image Generation' });

        if (!settings.defaultImageModel) {
            settings.defaultImageModel = {
                provider: 'google',
                model: 'gemini-2.5-flash-image'
            };
        }

        // Image Provider dropdown
        new Setting(imageSection)
            .setName('Image Provider')
            .setDesc('The provider to use for image generation')
            .addDropdown(dropdown => {
                const imageProviders: { id: 'google' | 'openrouter'; name: string }[] = [
                    { id: 'google', name: 'Google AI (Direct)' },
                    { id: 'openrouter', name: 'OpenRouter' }
                ];

                const enabledImageProviders = imageProviders.filter(p => {
                    const config = settings.providers[p.id];
                    return config?.enabled && config?.apiKey;
                });

                if (enabledImageProviders.length === 0) {
                    dropdown.addOption('', 'No image providers enabled');
                    imageProviders.forEach(p => {
                        dropdown.addOption(p.id, `${p.name} (not configured)`);
                    });
                } else {
                    enabledImageProviders.forEach(p => {
                        dropdown.addOption(p.id, p.name);
                    });
                }

                const currentProvider = settings.defaultImageModel?.provider || 'google';
                dropdown.setValue(currentProvider);

                dropdown.onChange(async (value) => {
                    const provider = value as 'google' | 'openrouter';
                    if (!settings.defaultImageModel) {
                        settings.defaultImageModel = { provider, model: '' };
                    } else {
                        settings.defaultImageModel.provider = provider;
                        settings.defaultImageModel.model = '';
                    }
                    await this.saveSettings();
                    this.render();
                });
            });

        // Image Model dropdown
        this.renderImageModelDropdown(imageSection, settings);
    }

    /**
     * Render the image model dropdown
     */
    private renderImageModelDropdown(container: HTMLElement, settings: LLMProviderSettings): void {
        const providerId = settings.defaultImageModel?.provider || 'google';

        const imageModels: Record<string, { id: string; name: string }[]> = {
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

        const models = imageModels[providerId] || [];

        new Setting(container)
            .setName('Image Model')
            .setDesc('The model to use for image generation')
            .addDropdown(dropdown => {
                if (models.length === 0) {
                    dropdown.addOption('', 'No models available');
                    dropdown.setValue('');
                    return;
                }

                models.forEach(model => {
                    dropdown.addOption(model.id, model.name);
                });

                const currentModel = settings.defaultImageModel?.model || '';
                const modelExists = models.some(m => m.id === currentModel);

                if (modelExists) {
                    dropdown.setValue(currentModel);
                } else if (models.length > 0) {
                    dropdown.setValue(models[0].id);
                    if (!settings.defaultImageModel) {
                        settings.defaultImageModel = { provider: providerId as 'google' | 'openrouter', model: models[0].id };
                    } else {
                        settings.defaultImageModel.model = models[0].id;
                    }
                    this.saveSettings();
                }

                dropdown.onChange(async (value) => {
                    if (!settings.defaultImageModel) {
                        settings.defaultImageModel = { provider: providerId as 'google' | 'openrouter', model: value };
                    } else {
                        settings.defaultImageModel.model = value;
                    }
                    await this.saveSettings();
                });
            });
    }

    /**
     * Cleanup
     */
    destroy(): void {
        // No resources to clean up
    }
}
