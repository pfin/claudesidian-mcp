/**
 * DirectToolExecutor - Executes tools directly via AgentExecutionManager
 *
 * This service enables tool execution without MCP protocol dependency,
 * allowing tools to work identically on both desktop and mobile platforms.
 *
 * Architecture:
 * - Desktop + Mobile (Nexus Chat): LLM → DirectToolExecutor → AgentExecutionManager → Agent
 * - Claude Desktop (external): Claude Desktop → MCP Protocol → connector.ts → Agent
 *
 * The MCP server/connector is ONLY needed for external clients (Claude Desktop).
 * The native chat UI uses this direct executor on ALL platforms.
 */

import { AgentExecutionManager } from '../../server/execution/AgentExecutionManager';
import { AgentRegistry } from '../../server/services/AgentRegistry';
import { SessionContextManager } from '../SessionContextManager';
import { ToolListService } from '../../handlers/services/ToolListService';
import { IAgent } from '../../agents/interfaces/IAgent';

export interface DirectToolCall {
    id: string;
    function: {
        name: string;
        arguments: string;
    };
}

export interface DirectToolResult {
    id: string;
    name?: string;
    success: boolean;
    result?: any;
    error?: string;
    executionTime?: number;
}

/**
 * Interface for agent providers - both AgentRegistry and AgentRegistrationService can fulfill this
 */
export interface AgentProvider {
    getAllAgents(): Map<string, IAgent> | IAgent[];
    getAgent?(name: string): IAgent | null;
    hasAgent?(name: string): boolean;
    agentSupportsMode?(agentName: string, modeName: string): boolean;
}

export interface DirectToolExecutorConfig {
    /** Agent provider - can be AgentRegistry, AgentRegistrationService, or any compatible provider */
    agentProvider: AgentProvider;
    sessionContextManager?: SessionContextManager;
}

/**
 * Direct tool execution service - bypasses MCP for native chat
 * Works identically on desktop and mobile platforms
 */
export class DirectToolExecutor {
    private executionManager: AgentExecutionManager;
    private toolListService: ToolListService;
    private agentProvider: AgentProvider;
    private internalRegistry: AgentRegistry;
    private cachedTools: any[] | null = null;

    constructor(config: DirectToolExecutorConfig) {
        this.agentProvider = config.agentProvider;

        // Create internal AgentRegistry for AgentExecutionManager
        // (AgentExecutionManager requires the specific AgentRegistry type)
        this.internalRegistry = new AgentRegistry();

        // Populate internal registry from provider
        const agents = this.getAgentsAsArray();
        for (const agent of agents) {
            try {
                this.internalRegistry.registerAgent(agent);
            } catch (e) {
                // Agent may already be registered (e.g., if provider is an AgentRegistry)
                console.log(`[DirectToolExecutor] Agent ${agent.name} already registered or error:`, e);
            }
        }

        this.executionManager = new AgentExecutionManager(
            this.internalRegistry,
            config.sessionContextManager
        );
        this.toolListService = new ToolListService();
    }

    /**
     * Get agents as an array (handles both Map and array return types)
     */
    private getAgentsAsArray(): IAgent[] {
        const result = this.agentProvider.getAllAgents();
        if (result instanceof Map) {
            return Array.from(result.values());
        }
        return result;
    }

    /**
     * Get available tools in OpenAI format
     * Returns only the get_tools meta-tool initially (matches MCP connector pattern)
     * LLM calls get_tools to discover and request specific tool schemas
     */
    async getAvailableTools(): Promise<any[]> {
        // Return only the meta-tool - LLM will call this to get actual tools
        return this.getMetaToolOnly();
    }

    /**
     * Get the meta-tool (get_tools) that LLM uses to fetch tool schemas
     * The system prompt already tells the LLM what agents are available
     */
    private getMetaToolOnly(): any[] {
        return [{
            type: 'function',
            function: {
                name: 'get_tools',
                description: `Get full tool schemas for specific agents. The system prompt lists available agents - use this to get their parameter schemas before calling them.

Example: get_tools({ tools: ["contentManager"] }) returns the full schema for contentManager.

After getting the schema, call the agent directly: contentManager({ mode: "readContent", path: "note.md", context: {...} })`,
                parameters: {
                    type: 'object',
                    properties: {
                        tools: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Agent names to get schemas for (e.g., ["contentManager", "vaultLibrarian"])'
                        }
                    },
                    required: ['tools']
                }
            }
        }];
    }

    /**
     * Get all tool schemas (internal - used when get_tools is called)
     */
    private async getAllToolSchemas(): Promise<any[]> {
        // Use cached tools if available
        if (this.cachedTools) {
            return this.cachedTools;
        }

        try {
            // Get agents from provider
            const agents = this.getAgentsAsArray();
            const agentMap = new Map<string, IAgent>();

            for (const agent of agents) {
                agentMap.set(agent.name, agent);
            }

            // Generate tool list using existing service
            const { tools } = await this.toolListService.generateToolList(
                agentMap,
                true // isVaultEnabled - always true for native chat
            );

            // Convert to OpenAI format
            this.cachedTools = tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema
                }
            }));

            console.log(`[DirectToolExecutor] Generated ${this.cachedTools.length} tools from ${agents.length} agents`);
            return this.cachedTools;
        } catch (error) {
            console.error('[DirectToolExecutor] Failed to get available tools:', error);
            return [];
        }
    }

    /**
     * Invalidate cached tools (call when agents change)
     */
    invalidateToolCache(): void {
        this.cachedTools = null;
    }

    /**
     * Execute a tool call directly via AgentExecutionManager
     * This is the core method that bypasses MCP
     */
    async executeTool(
        toolName: string,
        params: Record<string, any>,
        context?: { sessionId?: string; workspaceId?: string }
    ): Promise<any> {
        try {
            // Handle special get_tools meta-tool
            if (toolName === 'get_tools') {
                return await this.handleGetTools(params, context);
            }

            // Tool name format: "agentName" with mode in params
            // Or legacy format: "agentName_modeName"
            let agent: string;
            let mode: string;

            if (params.mode) {
                // New format: mode is in params
                agent = toolName;
                mode = params.mode;
            } else if (toolName.includes('_')) {
                // Legacy format: agentName_modeName
                const parts = toolName.split('_');
                agent = parts[0];
                mode = parts.slice(1).join('_');
            } else {
                throw new Error(`Invalid tool call: no mode specified for ${toolName}`);
            }

            // Determine sessionId and workspaceId with priority:
            // 1. External context (from chat settings/workspace selection)
            // 2. LLM-provided params.context
            // 3. Generate default if neither exists
            const effectiveSessionId = context?.sessionId
                || params.context?.sessionId
                || `session_${Date.now()}`;
            const effectiveWorkspaceId = context?.workspaceId
                || params.context?.workspaceId
                || 'default';

            const paramsWithContext = {
                ...params,
                context: {
                    ...params.context,
                    sessionId: effectiveSessionId,
                    workspaceId: effectiveWorkspaceId
                }
            };

            // Execute via AgentExecutionManager
            const result = await this.executionManager.executeAgentModeWithValidation(
                agent,
                mode,
                paramsWithContext
            );

            return result;
        } catch (error) {
            console.error(`[DirectToolExecutor] Tool execution failed for ${toolName}:`, error);
            throw error;
        }
    }

    /**
     * Handle the get_tools meta-tool call
     * Returns tool schemas for requested agents
     */
    private async handleGetTools(
        params: Record<string, any>,
        context?: { sessionId?: string; workspaceId?: string }
    ): Promise<any> {
        const requestedTools = params.tools as string[] | undefined;
        const sessionId = context?.sessionId || 'session_' + Date.now();
        const workspaceId = context?.workspaceId || 'default';

        // No tools requested - remind to specify which tools
        if (!requestedTools || requestedTools.length === 0) {
            return {
                success: false,
                error: 'Please specify which agent tools you need. Example: get_tools({ tools: ["contentManager", "vaultLibrarian"] })',
                availableAgents: ['contentManager', 'vaultManager', 'vaultLibrarian', 'memoryManager', 'commandManager', 'agentManager']
            };
        }

        // Get schemas for requested tools
        const allTools = await this.getAllToolSchemas();
        const matchedTools: any[] = [];
        const notFound: string[] = [];

        for (const toolName of requestedTools) {
            const tool = allTools.find(t => t.function.name === toolName);
            if (tool) {
                matchedTools.push(tool);
            } else {
                notFound.push(toolName);
            }
        }

        return {
            success: true,
            tools: matchedTools,
            count: matchedTools.length,
            notFound: notFound.length > 0 ? notFound : undefined,
            reminder: `Use sessionId: "${sessionId}" and workspaceId: "${workspaceId}" in context for all tool calls.`
        };
    }

    /**
     * Execute multiple tool calls
     * Matches the interface expected by MCPToolExecution
     */
    async executeToolCalls(
        toolCalls: DirectToolCall[],
        context?: { sessionId?: string; workspaceId?: string },
        onToolEvent?: (event: 'started' | 'completed', data: any) => void
    ): Promise<DirectToolResult[]> {
        const results: DirectToolResult[] = [];

        for (const toolCall of toolCalls) {
            const startTime = Date.now();

            try {
                // Parse arguments
                let parameters: any = {};
                const argumentsStr = toolCall.function.arguments || '{}';

                try {
                    parameters = JSON.parse(argumentsStr);
                } catch (parseError) {
                    throw new Error(`Invalid tool arguments: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
                }

                // Notify tool started
                onToolEvent?.('started', {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    parameters: parameters
                });

                // Execute the tool
                const result = await this.executeTool(
                    toolCall.function.name,
                    parameters,
                    context
                );

                const executionTime = Date.now() - startTime;

                results.push({
                    id: toolCall.id,
                    name: toolCall.function.name,
                    success: result.success !== false, // Default to true if not explicitly false
                    result: result.success !== false ? result : undefined,
                    error: result.success === false ? (result.error || 'Tool execution failed') : undefined,
                    executionTime
                });

                // Notify tool completed
                onToolEvent?.('completed', {
                    toolId: toolCall.id,
                    result: result.success !== false ? result : undefined,
                    success: result.success !== false,
                    error: result.success === false ? (result.error || 'Tool execution failed') : undefined
                });

            } catch (error) {
                const executionTime = Date.now() - startTime;

                results.push({
                    id: toolCall.id,
                    name: toolCall.function.name,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                    executionTime
                });

                // Notify tool completed (with error)
                onToolEvent?.('completed', {
                    toolId: toolCall.id,
                    result: undefined,
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        return results;
    }

    /**
     * Check if tool execution is available
     * Always returns true since this doesn't depend on MCP
     */
    isAvailable(): boolean {
        return true;
    }

    /**
     * Get execution manager for advanced operations
     */
    getExecutionManager(): AgentExecutionManager {
        return this.executionManager;
    }
}
