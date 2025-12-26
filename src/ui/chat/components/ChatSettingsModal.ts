/**
 * ChatSettingsModal - Modal for configuring chat session settings
 *
 * Uses ChatSettingsRenderer for identical UI to DefaultsTab.
 * Saves to conversation metadata (this session only).
 */

import { App, Modal, ButtonComponent, Plugin } from 'obsidian';
import { WorkspaceService } from '../../../services/WorkspaceService';
import { ModelAgentManager } from '../services/ModelAgentManager';
import { ChatSettingsRenderer, ChatSettings } from '../../../components/shared/ChatSettingsRenderer';
import { getNexusPlugin } from '../../../utils/pluginLocator';
import { Settings } from '../../../settings';

/**
 * Type for the NexusPlugin with settings property
 * Used to access plugin settings in a type-safe way
 */
interface NexusPluginWithSettings extends Plugin {
  settings?: Settings;
}

export class ChatSettingsModal extends Modal {
  private workspaceService: WorkspaceService;
  private modelAgentManager: ModelAgentManager;
  private conversationId: string | null;
  private renderer: ChatSettingsRenderer | null = null;
  private pendingSettings: ChatSettings | null = null;

  constructor(
    app: App,
    conversationId: string | null,
    workspaceService: WorkspaceService,
    modelAgentManager: ModelAgentManager
  ) {
    super(app);
    this.conversationId = conversationId;
    this.workspaceService = workspaceService;
    this.modelAgentManager = modelAgentManager;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('chat-settings-modal');

    // Header with buttons
    const header = contentEl.createDiv('chat-settings-header');
    header.createEl('h2', { text: 'Chat Settings' });

    const buttonContainer = header.createDiv('chat-settings-buttons');
    new ButtonComponent(buttonContainer)
      .setButtonText('Cancel')
      .onClick(() => this.close());

    new ButtonComponent(buttonContainer)
      .setButtonText('Save')
      .setCta()
      .onClick(() => this.handleSave());

    // Load data and render
    await this.loadAndRender(contentEl);
  }

  private async loadAndRender(contentEl: HTMLElement): Promise<void> {
    const plugin = getNexusPlugin<NexusPluginWithSettings>(this.app);
    const llmProviderSettings = plugin?.settings?.settings?.llmProviders;

    if (!llmProviderSettings) {
      contentEl.createEl('p', { text: 'Settings not available' });
      return;
    }

    // Load workspaces and agents
    const workspaces = await this.loadWorkspaces();
    const agents = await this.loadAgents();

    // Get current settings from ModelAgentManager
    const initialSettings = this.getCurrentSettings();

    // Create renderer
    const rendererContainer = contentEl.createDiv('chat-settings-renderer');

    this.renderer = new ChatSettingsRenderer(rendererContainer, {
      app: this.app,
      llmProviderSettings,
      initialSettings,
      options: { workspaces, agents },
      callbacks: {
        onSettingsChange: (settings) => {
          this.pendingSettings = settings;
        }
      }
    });

    this.renderer.render();
  }

  private async loadWorkspaces(): Promise<Array<{ id: string; name: string }>> {
    try {
      const workspaces = await this.workspaceService.listWorkspaces();
      return workspaces.map(w => ({ id: w.id, name: w.name }));
    } catch {
      return [];
    }
  }

  private async loadAgents(): Promise<Array<{ id: string; name: string }>> {
    try {
      const agents = await this.modelAgentManager.getAvailableAgents();
      return agents.map(a => ({ id: a.id || a.name, name: a.name }));
    } catch {
      return [];
    }
  }

  private getCurrentSettings(): ChatSettings {
    const model = this.modelAgentManager.getSelectedModel();
    const agent = this.modelAgentManager.getSelectedAgent();
    const thinking = this.modelAgentManager.getThinkingSettings();
    const contextNotes = this.modelAgentManager.getContextNotes();
    const temperature = this.modelAgentManager.getTemperature();

    // Get plugin defaults for image settings
    const plugin = getNexusPlugin<NexusPluginWithSettings>(this.app);
    const llmSettings = plugin?.settings?.settings?.llmProviders;

    return {
      provider: model?.providerId || llmSettings?.defaultModel?.provider || '',
      model: model?.modelId || llmSettings?.defaultModel?.model || '',
      thinking: {
        enabled: thinking?.enabled ?? false,
        effort: thinking?.effort ?? 'medium'
      },
      temperature: temperature,
      imageProvider: llmSettings?.defaultImageModel?.provider || 'google',
      imageModel: llmSettings?.defaultImageModel?.model || 'gemini-2.5-flash-image',
      workspaceId: this.modelAgentManager.getSelectedWorkspaceId(),
      agentId: agent?.id || agent?.name || null,
      contextNotes: [...contextNotes]
    };
  }

  private async handleSave(): Promise<void> {
    if (!this.pendingSettings) {
      this.pendingSettings = this.renderer?.getSettings() || null;
    }

    if (!this.pendingSettings) {
      this.close();
      return;
    }

    try {
      const settings = this.pendingSettings;

      // Update model
      const availableModels = await this.modelAgentManager.getAvailableModels();
      const model = availableModels.find(
        m => m.providerId === settings.provider && m.modelId === settings.model
      );
      if (model) {
        this.modelAgentManager.handleModelChange(model);
      }

      // Update agent
      if (settings.agentId) {
        const availableAgents = await this.modelAgentManager.getAvailableAgents();
        const agent = availableAgents.find(a => a.id === settings.agentId || a.name === settings.agentId);
        await this.modelAgentManager.handleAgentChange(agent || null);
      } else {
        await this.modelAgentManager.handleAgentChange(null);
      }

      // Update workspace
      if (settings.workspaceId) {
        const workspace = await this.workspaceService.getWorkspace(settings.workspaceId);
        if (workspace?.context) {
          await this.modelAgentManager.setWorkspaceContext(settings.workspaceId, workspace.context);
        }
      } else {
        await this.modelAgentManager.clearWorkspaceContext();
      }

      // Update thinking
      this.modelAgentManager.setThinkingSettings(settings.thinking);

      // Update temperature
      this.modelAgentManager.setTemperature(settings.temperature);

      // Update context notes
      await this.modelAgentManager.setContextNotes(settings.contextNotes);

      // Save to conversation metadata
      if (this.conversationId) {
        await this.modelAgentManager.saveToConversation(this.conversationId);
      }

      this.close();
    } catch (error) {
      console.error('[ChatSettingsModal] Error saving settings:', error);
    }
  }

  onClose() {
    this.renderer = null;
    this.pendingSettings = null;
    this.contentEl.empty();
  }
}
