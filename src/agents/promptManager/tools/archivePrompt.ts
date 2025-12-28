import { BaseTool } from '../../baseTool';
import { ArchiveAgentParams, ArchiveAgentResult } from '../types';
import { CustomPromptStorageService } from '../services/CustomPromptStorageService';

/**
 * Tool for archiving a custom agent
 *
 * Location: src/agents/agentManager/tools/archiveAgent.ts
 *
 * Functionality: Sets isEnabled flag to false on an agent, making it disappear from
 * active listings while preserving its configuration for potential restoration.
 *
 * Relationships:
 * - Uses CustomPromptStorageService to update agent enabled status
 * - Agent can be restored via updateAgent tool with isEnabled: true
 * - Integrates with listAgents tool which filters archived agents by default
 */
export class ArchiveAgentTool extends BaseTool<ArchiveAgentParams, ArchiveAgentResult> {
  private storageService: CustomPromptStorageService;

  /**
   * Create a new ArchiveAgentTool
   * @param storageService Custom prompt storage service
   */
  constructor(storageService: CustomPromptStorageService) {
    super(
      'archiveAgent',
      'Archive Agent',
      'Archive a custom agent by disabling it (preserves configuration for restoration)',
      '1.0.0'
    );

    this.storageService = storageService;
  }

  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise that resolves with archive result
   */
  async execute(params: ArchiveAgentParams): Promise<ArchiveAgentResult> {
    try {
      const { name } = params;

      // Validate required name
      if (!name?.trim()) {
        return this.prepareResult(false, undefined, 'Agent name is required');
      }

      // Check if agent exists (unified lookup by ID or name)
      const existingAgent = this.storageService.getPromptByNameOrId(name.trim());
      if (!existingAgent) {
        return this.prepareResult(false, undefined, `Agent "${name}" not found. Use listAgents to see available agents.`);
      }

      // Archive the agent by setting isEnabled to false
      await this.storageService.updatePrompt(existingAgent.id, { isEnabled: false });

      // Success - LLM already knows what it archived
      return this.prepareResult(true);
    } catch (error) {
      return this.prepareResult(false, undefined, `Failed to archive agent: ${error}`);
    }
  }

  /**
   * Get the JSON schema for the tool's parameters
   * @returns JSON schema object
   */
  getParameterSchema(): any {
    const toolSchema = {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name or ID of the agent to archive. Agent will be disabled but configuration preserved for restoration via updateAgent.',
          minLength: 1
        }
      },
      required: ['name']
    };

    return this.getMergedSchema(toolSchema);
  }

  getResultSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        success: { type: 'boolean', description: 'Whether the operation succeeded' },
        error: { type: 'string', description: 'Error message if failed (includes recovery guidance)' }
      },
      required: ['success']
    };
  }
}
