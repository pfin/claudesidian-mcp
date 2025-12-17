/**
 * Initialize suggesters for a contenteditable element
 */

import { App, Plugin } from 'obsidian';
import { TextAreaNoteSuggester } from './TextAreaNoteSuggester';
import { TextAreaToolSuggester } from './TextAreaToolSuggester';
import { TextAreaAgentSuggester } from './TextAreaAgentSuggester';
import { TextAreaWorkspaceSuggester } from './TextAreaWorkspaceSuggester';
import { MessageEnhancer } from '../../services/MessageEnhancer';
import { CustomPromptStorageService } from '../../../../agents/agentManager/services/CustomPromptStorageService';
import { WorkspaceService } from '../../../../services/WorkspaceService';
import { getNexusPlugin } from '../../../../utils/pluginLocator';
import type { Settings } from '../../../../settings';

/**
 * Interface for NexusPlugin with settings and services
 */
interface NexusPluginWithServices extends Plugin {
  settings?: Settings;
  services?: Record<string, unknown>;
  workspaceService?: WorkspaceService;
}

export interface SuggesterInstances {
  noteSuggester: TextAreaNoteSuggester;
  toolSuggester: TextAreaToolSuggester;
  agentSuggester?: TextAreaAgentSuggester;
  workspaceSuggester?: TextAreaWorkspaceSuggester;
  messageEnhancer: MessageEnhancer;
  cleanup: () => void;
}

export function initializeSuggesters(
  app: App,
  element: HTMLElement
): SuggesterInstances {
  const messageEnhancer = new MessageEnhancer();

  // Create suggesters
  const noteSuggester = new TextAreaNoteSuggester(app, element, messageEnhancer);
  const toolSuggester = new TextAreaToolSuggester(app, element, messageEnhancer);

  // Try to get CustomPromptStorageService for agent suggester
  let agentSuggester: TextAreaAgentSuggester | undefined;
  let workspaceSuggester: TextAreaWorkspaceSuggester | undefined;
  try {
    const plugin = getNexusPlugin<NexusPluginWithServices>(app);
    if (plugin?.settings) {
      const promptStorage = new CustomPromptStorageService(plugin.settings);
      agentSuggester = new TextAreaAgentSuggester(app, element, messageEnhancer, promptStorage);
    }

    // Initialize workspace suggester
    if (plugin) {
      const workspaceService = plugin.workspaceService ||
        (plugin.services?.workspaceService as WorkspaceService | undefined);
      if (workspaceService) {
        workspaceSuggester = new TextAreaWorkspaceSuggester(app, element, messageEnhancer, workspaceService);
      }
    }
  } catch (error) {
    // Agent/workspace suggester initialization failed - will be undefined
  }

  return {
    noteSuggester,
    toolSuggester,
    agentSuggester,
    workspaceSuggester,
    messageEnhancer,
    cleanup: () => {
      noteSuggester.destroy();
      toolSuggester.destroy();
      agentSuggester?.destroy();
      workspaceSuggester?.destroy();
      messageEnhancer.clearEnhancements();
    }
  };
}
