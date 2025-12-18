/**
 * CancelSubagentTool - Cancel a running subagent
 *
 * Allows the parent agent to cancel a running subagent by ID or branch ID.
 * The subagent's state will be set to 'cancelled'.
 *
 * This tool is INTERNAL ONLY - hidden from MCP/Claude Desktop clients.
 */

import { BaseTool } from '../../baseTool';
import { getCommonResultSchema, createResult } from '../../../utils/schemaUtils';
import { CommonParameters, CommonResult } from '../../../types';
import type { SubagentExecutor } from '../../../services/chat/SubagentExecutor';

export interface CancelSubagentParams extends CommonParameters {
  subagentId?: string;
  branchId?: string;
}

export interface CancelSubagentResult extends CommonResult {
  data: {
    cancelled: boolean;
    finalState: 'cancelled' | 'not_found' | 'already_complete';
    message: string;
  } | null;
}

/**
 * Context provided by the execution environment
 */
export interface CancelSubagentToolContext {
  source?: 'internal' | 'mcp';
}

export class CancelSubagentTool extends BaseTool<CancelSubagentParams, CancelSubagentResult> {
  private subagentExecutor: SubagentExecutor | null = null;
  private contextProvider: (() => CancelSubagentToolContext) | null = null;

  constructor() {
    super(
      'cancelSubagent',
      'Cancel Subagent',
      `Cancel a running subagent by its ID or branch ID.
Use when a subagent is no longer needed or taking too long.
The subagent's state will be set to 'cancelled'.`,
      '1.0.0'
    );
  }

  /**
   * Set the subagent executor (called during agent initialization)
   */
  setSubagentExecutor(executor: SubagentExecutor): void {
    this.subagentExecutor = executor;
  }

  /**
   * Set the context provider (called during agent initialization)
   */
  setContextProvider(provider: () => CancelSubagentToolContext): void {
    this.contextProvider = provider;
  }

  async execute(params: CancelSubagentParams): Promise<CancelSubagentResult> {
    const { subagentId, branchId } = params;

    // Validate executor is available
    if (!this.subagentExecutor) {
      return createResult<CancelSubagentResult>(
        false,
        null,
        'Subagent executor not initialized'
      );
    }

    // Get execution context
    const context = this.contextProvider?.();

    // Block MCP clients
    if (context?.source === 'mcp') {
      return createResult<CancelSubagentResult>(
        false,
        null,
        'Cancel subagent tool is only available in internal chat'
      );
    }

    // Must provide either subagentId or branchId
    if (!subagentId && !branchId) {
      return createResult<CancelSubagentResult>(
        false,
        null,
        'Must provide either subagentId or branchId'
      );
    }

    try {
      // Try to cancel
      const cancelled = subagentId
        ? this.subagentExecutor.cancelSubagent(subagentId)
        : this.subagentExecutor.cancelSubagentByBranch(branchId!);

      if (cancelled) {
        return createResult<CancelSubagentResult>(true, {
          cancelled: true,
          finalState: 'cancelled',
          message: 'Subagent cancelled successfully',
        });
      }

      // Check if already complete
      const state = this.subagentExecutor.getSubagentState(subagentId || branchId!);
      if (state === 'complete' || state === 'max_iterations') {
        return createResult<CancelSubagentResult>(true, {
          cancelled: false,
          finalState: 'already_complete',
          message: 'Subagent already finished',
        });
      }

      return createResult<CancelSubagentResult>(true, {
        cancelled: false,
        finalState: 'not_found',
        message: 'Subagent not found',
      });
    } catch (error) {
      return createResult<CancelSubagentResult>(
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
        subagentId: {
          type: 'string',
          description: 'The subagent ID returned when spawned',
        },
        branchId: {
          type: 'string',
          description: 'The branch ID where subagent is running',
        },
      },
      anyOf: [{ required: ['subagentId'] }, { required: ['branchId'] }],
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
                cancelled: { type: 'boolean', description: 'Whether the subagent was cancelled' },
                finalState: {
                  type: 'string',
                  enum: ['cancelled', 'not_found', 'already_complete'],
                  description: 'Final state of the subagent',
                },
                message: { type: 'string', description: 'Status message' },
              },
              required: ['cancelled', 'finalState', 'message'],
            },
          ],
        },
      },
    };
  }
}
