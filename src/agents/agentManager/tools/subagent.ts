/**
 * SubagentTool - Spawn or cancel autonomous subagents
 *
 * Actions:
 * - spawn: Create a new subagent to work on a task in the background
 * - cancel: Cancel a running subagent by ID or branch ID
 *
 * The subagent runs independently in a branch, using tools as needed,
 * until it completes the task (responds without tool calls).
 *
 * This tool is INTERNAL ONLY - hidden from MCP/Claude Desktop clients.
 */

import { BaseTool } from '../../baseTool';
import { getCommonResultSchema, createResult } from '../../../utils/schemaUtils';
import { CommonParameters, CommonResult } from '../../../types';
import type { SubagentExecutor } from '../../../services/chat/SubagentExecutor';

/**
 * Action type for subagent operations
 */
export type SubagentAction = 'spawn' | 'cancel';

export interface SubagentToolParams extends CommonParameters {
  action: SubagentAction;
  // Spawn params
  task?: string;
  agent?: string;
  tools?: Record<string, string[]>;
  contextFiles?: string[];
  additionalContext?: string;
  maxIterations?: number;
  continueBranchId?: string;
  // Cancel params
  subagentId?: string;
  branchId?: string;
}

export interface SubagentToolResult extends CommonResult {
  data: {
    // Spawn result
    subagentId?: string;
    branchId?: string;
    status?: 'started' | 'continued' | 'cancelled' | 'not_found' | 'already_complete';
    message: string;
    // Cancel result
    cancelled?: boolean;
  } | null;
}

/**
 * Context provided by the execution environment
 */
export interface SubagentToolContext {
  conversationId: string;
  messageId: string;
  workspaceId?: string;
  sessionId?: string;
  source?: 'internal' | 'mcp';
  isSubagentBranch?: boolean;
}

/**
 * Guard function to block MCP clients from using internal-only tools
 */
function blockMCPClient<T extends CommonResult>(
  context: SubagentToolContext | undefined,
  toolName: string
): T | null {
  if (context?.source === 'mcp') {
    console.warn(`[${toolName}] Blocked MCP client attempt`);
    return createResult<T>(
      false,
      null,
      `${toolName} is only available in internal chat`
    );
  }
  return null;
}

export class SubagentTool extends BaseTool<SubagentToolParams, SubagentToolResult> {
  private subagentExecutor: SubagentExecutor | null = null;
  private contextProvider: (() => SubagentToolContext) | null = null;

  constructor() {
    super(
      'subagent',
      'Subagent',
      `Manage autonomous subagents that work on tasks in the background.

Actions:
- spawn: Create a new subagent to work on a task
- cancel: Cancel a running subagent

Spawn a subagent for:
- Deep research tasks requiring multiple searches
- Analysis tasks that need file reading and processing
- Complex operations you want to run in parallel

The subagent has access to all tools via getTools.
Results appear as a tool result when the subagent finishes.

To continue a subagent that hit max iterations, use spawn with continueBranchId.`,
      '2.0.0'
    );
    console.log('[SubagentTool] Constructor called');
  }

  /**
   * Set the subagent executor (called during agent initialization)
   */
  setSubagentExecutor(executor: SubagentExecutor): void {
    console.log('[SubagentTool] setSubagentExecutor called, executor:', !!executor);
    this.subagentExecutor = executor;
  }

  /**
   * Set the context provider (called during agent initialization)
   */
  setContextProvider(provider: () => SubagentToolContext): void {
    console.log('[SubagentTool] setContextProvider called');
    this.contextProvider = provider;
  }

  async execute(params: SubagentToolParams): Promise<SubagentToolResult> {
    const action = params.action || 'spawn';

    console.log('[SubagentTool] execute called with action:', action);

    // Validate executor is available
    if (!this.subagentExecutor) {
      console.error('[SubagentTool] Subagent executor not initialized');
      return createResult<SubagentToolResult>(
        false,
        null,
        'Subagent executor not initialized'
      );
    }

    // Get execution context
    const context = this.contextProvider?.();

    // Block MCP clients
    const blocked = blockMCPClient<SubagentToolResult>(context, 'Subagent tool');
    if (blocked) return blocked;

    // Route to appropriate handler
    if (action === 'cancel') {
      return this.handleCancel(params);
    } else {
      return this.handleSpawn(params, context);
    }
  }

  /**
   * Handle spawn action
   */
  private async handleSpawn(
    params: SubagentToolParams,
    context: SubagentToolContext | undefined
  ): Promise<SubagentToolResult> {
    if (!context) {
      console.error('[SubagentTool] Execution context not available');
      return createResult<SubagentToolResult>(
        false,
        null,
        'Execution context not available'
      );
    }

    // Block subagents from spawning subagents
    if (context.isSubagentBranch) {
      console.warn('[SubagentTool] Blocked subagent from spawning another subagent');
      return createResult<SubagentToolResult>(
        false,
        null,
        'Subagents cannot spawn other subagents. Ask the parent agent to spawn additional subagents.'
      );
    }

    // Validate task is provided
    if (!params.task) {
      return createResult<SubagentToolResult>(
        false,
        null,
        'Task is required for spawn action'
      );
    }

    try {
      console.log('[SubagentTool] Spawning subagent for task:', params.task);

      const { subagentId, branchId } = await this.subagentExecutor!.executeSubagent({
        task: params.task,
        parentConversationId: context.conversationId,
        parentMessageId: context.messageId,
        agent: params.agent,
        tools: params.tools,
        contextFiles: params.contextFiles,
        context: params.additionalContext,
        workspaceId: context.workspaceId,
        sessionId: context.sessionId,
        maxIterations: params.maxIterations,
        continueBranchId: params.continueBranchId,
      });

      const isContinuing = !!params.continueBranchId;

      console.log('[SubagentTool] Subagent spawned:', { subagentId, branchId, isContinuing });

      return createResult<SubagentToolResult>(true, {
        subagentId,
        branchId,
        status: isContinuing ? 'continued' : 'started',
        message: isContinuing
          ? `Continuing subagent. Branch: ${branchId}`
          : `Subagent started. Working on: "${params.task}". Results will appear when complete.`,
      });
    } catch (error) {
      console.error('[SubagentTool] Failed to spawn subagent:', error);
      return createResult<SubagentToolResult>(
        false,
        null,
        `Failed to spawn subagent: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Handle cancel action
   */
  private async handleCancel(params: SubagentToolParams): Promise<SubagentToolResult> {
    const { subagentId, branchId } = params;

    // Must provide either subagentId or branchId
    if (!subagentId && !branchId) {
      return createResult<SubagentToolResult>(
        false,
        null,
        'Must provide either subagentId or branchId for cancel action'
      );
    }

    try {
      // Try to cancel
      const cancelled = subagentId
        ? this.subagentExecutor!.cancelSubagent(subagentId)
        : this.subagentExecutor!.cancelSubagentByBranch(branchId!);

      if (cancelled) {
        return createResult<SubagentToolResult>(true, {
          cancelled: true,
          status: 'cancelled',
          message: 'Subagent cancelled successfully',
        });
      }

      // Check if already complete
      const state = this.subagentExecutor!.getSubagentState(subagentId || branchId!);
      if (state === 'complete' || state === 'max_iterations') {
        return createResult<SubagentToolResult>(true, {
          cancelled: false,
          status: 'already_complete',
          message: 'Subagent already finished',
        });
      }

      return createResult<SubagentToolResult>(true, {
        cancelled: false,
        status: 'not_found',
        message: 'Subagent not found',
      });
    } catch (error) {
      return createResult<SubagentToolResult>(
        false,
        null,
        `Failed to cancel subagent: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  getParameterSchema(): Record<string, unknown> {
    const toolSchema = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['spawn', 'cancel'],
          description: 'Action to perform: spawn a new subagent or cancel an existing one',
          default: 'spawn',
        },
        // Spawn params
        task: {
          type: 'string',
          description: '[spawn] Clear description of what the subagent should accomplish',
        },
        agent: {
          type: 'string',
          description: '[spawn] Optional custom agent/persona name to use',
        },
        tools: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
          description: '[spawn] Pre-fetched tools: { agentName: [toolSlug1, toolSlug2] }',
        },
        contextFiles: {
          type: 'array',
          items: { type: 'string' },
          description: '[spawn] File paths to read and include as context',
        },
        additionalContext: {
          type: 'string',
          description: '[spawn] Additional context to provide to the subagent',
        },
        maxIterations: {
          type: 'number',
          description: '[spawn] Maximum iterations before pausing (default: 10)',
        },
        continueBranchId: {
          type: 'string',
          description: '[spawn] Branch ID to continue from max_iterations state',
        },
        // Cancel params
        subagentId: {
          type: 'string',
          description: '[cancel] The subagent ID to cancel',
        },
        branchId: {
          type: 'string',
          description: '[cancel] The branch ID to cancel (alternative to subagentId)',
        },
      },
      required: ['action'],
    };

    return this.getMergedSchema(toolSchema);
  }

  getResultSchema(): Record<string, unknown> {
    const commonSchema = getCommonResultSchema();

    return {
      ...commonSchema,
      properties: {
        ...commonSchema.properties,
        data: {
          oneOf: [
            { type: 'null' },
            {
              type: 'object',
              properties: {
                subagentId: { type: 'string', description: 'Subagent ID (spawn)' },
                branchId: { type: 'string', description: 'Branch ID (spawn)' },
                status: {
                  type: 'string',
                  enum: ['started', 'continued', 'cancelled', 'not_found', 'already_complete'],
                  description: 'Result status',
                },
                message: { type: 'string', description: 'Status message' },
                cancelled: { type: 'boolean', description: 'Whether cancel succeeded' },
              },
              required: ['message'],
            },
          ],
        },
      },
    };
  }
}
