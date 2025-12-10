/**
 * Tool Execution Utility
 *
 * Clean architecture: Tool execution is decoupled from LLM adapters.
 * Adapters handle LLM communication, this utility handles tool execution.
 *
 * The toolExecutor is passed explicitly - no reaching into adapter internals.
 * This enables tools to work on ALL platforms (desktop + mobile).
 */

import { SupportedProvider } from '../../../mcp-bridge/types/BridgeTypes';

export interface MCPToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface MCPToolResult {
  id: string;
  name?: string;
  success: boolean;
  result?: any;
  error?: string;
  executionTime?: number;
}

/**
 * Interface for tool executors
 * Both DirectToolExecutor and any future executors should implement this
 */
export interface IToolExecutor {
  executeToolCalls(
    toolCalls: MCPToolCall[],
    context?: { sessionId?: string; workspaceId?: string },
    onToolEvent?: (event: 'started' | 'completed', data: any) => void
  ): Promise<MCPToolResult[]>;
}

/**
 * @deprecated Legacy interface - adapters no longer need mcpConnector
 * Kept for backward compatibility during migration
 */
export interface MCPCapableAdapter {
  mcpConnector?: any;
}

/**
 * Static utility class for tool execution
 * Decoupled from adapters - receives toolExecutor explicitly
 */
export class MCPToolExecution {

  /**
   * @deprecated Tool support is now determined by whether toolExecutor is provided
   * This method always returns false since adapters no longer have mcpConnector
   */
  static supportsMCP(_adapter: any): boolean {
    console.warn('[MCPToolExecution] supportsMCP is deprecated - use toolExecutor instead');
    return false;
  }

  /**
   * @deprecated Use StreamingOrchestrator for tool execution instead
   * This method is no longer functional - tool execution happens in StreamingOrchestrator
   */
  static async executeWithToolSupport<T>(
    _adapter: any,
    provider: string,
    _options: any,
    _callbacks: any
  ): Promise<any> {
    throw new Error(
      `[MCPToolExecution] executeWithToolSupport is deprecated for ${provider}. ` +
      `Tool execution now happens in StreamingOrchestrator. ` +
      `Use the streaming API (generateResponseStream) for tool support.`
    );
  }

  /**
   * Execute tool calls using the provided executor
   * Clean interface - no adapter dependency
   */
  static async executeToolCalls(
    toolExecutor: IToolExecutor | null | undefined,
    toolCalls: MCPToolCall[],
    provider: SupportedProvider,
    onToolEvent?: (event: 'started' | 'completed', data: any) => void,
    context?: { sessionId?: string; workspaceId?: string }
  ): Promise<MCPToolResult[]> {
    if (!toolExecutor) {
      console.warn(`[MCPToolExecution] No tool executor available for ${provider}`);
      return toolCalls.map(tc => ({
        id: tc.id,
        name: tc.function.name,
        success: false,
        error: 'Tool execution not available - no executor configured'
      }));
    }

    try {
      console.log(`[MCPToolExecution] Executing ${toolCalls.length} tool calls for ${provider}`);
      return await toolExecutor.executeToolCalls(toolCalls, context, onToolEvent);
    } catch (error) {
      console.error(`[MCPToolExecution] Tool execution failed:`, error);
      throw error;
    }
  }

  /**
   * Build tool messages for continuation
   * Formats differently for Anthropic, Google, vs other providers
   */
  static buildToolMessages(
    toolResults: MCPToolResult[],
    provider: SupportedProvider
  ): Array<any> {
    if (provider === 'anthropic') {
      // Anthropic format: role='user', content array with tool_result objects
      return toolResults.map(result => ({
        role: 'user' as const,
        content: [
          {
            type: 'tool_result',
            tool_use_id: result.id,
            content: result.success
              ? JSON.stringify(result.result)
              : `Error: ${result.error}`
          }
        ]
      }));
    } else if (provider === 'google') {
      // Google Gemini format: role='function', parts array with functionResponse objects
      return toolResults.map(result => ({
        role: 'function' as const,
        parts: [
          {
            functionResponse: {
              name: result.name,
              response: result.success
                ? result.result
                : { error: result.error }
            }
          }
        ]
      }));
    } else {
      // OpenAI format (used by OpenAI, OpenRouter, Groq, Mistral, etc.)
      return toolResults.map(result => ({
        role: 'tool' as const,
        tool_call_id: result.id,
        content: result.success
          ? JSON.stringify(result.result)
          : `Error: ${result.error}`
      }));
    }
  }

  /**
   * Build tool metadata for response
   */
  static buildToolMetadata(toolResults: MCPToolResult[]) {
    return {
      mcpEnabled: true,
      toolCallCount: toolResults.length,
      toolCalls: toolResults.length > 0 ? toolResults.map(result => ({
        id: result.id,
        name: result.name,
        result: result.result,
        success: result.success,
        error: result.error,
        executionTime: result.executionTime
      })) : undefined
    };
  }
}
