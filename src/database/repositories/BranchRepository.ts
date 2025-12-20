/**
 * Location: src/database/repositories/BranchRepository.ts
 *
 * Branch Repository
 *
 * Manages branch persistence in conversation JSONL files.
 * Branches are stored separately from messages for conflict-free append-only writes.
 *
 * Storage Strategy:
 * - JSONL: conversations/conv_{conversationId}.jsonl (same file as messages, different event types)
 * - SQLite: branches and branch_messages tables (cache for fast queries)
 *
 * Related Files:
 * - src/database/interfaces/StorageEvents.ts - Branch event types
 * - src/types/branch/BranchTypes.ts - Branch data structures
 * - src/services/chat/BranchService.ts - High-level branch operations
 */

import { BaseRepository, RepositoryDependencies } from './base/BaseRepository';
import { BranchCreatedEvent, BranchMessageEvent, BranchMessageUpdatedEvent, BranchUpdatedEvent } from '../interfaces/StorageEvents';
import { PaginatedResult, PaginationParams } from '../../types/pagination/PaginationTypes';
import type { ConversationBranch, BranchType, SubagentBranchMetadata, HumanBranchMetadata } from '../../types/branch/BranchTypes';
import type { ChatMessage } from '../../types/chat/ChatTypes';

/**
 * Data for creating a new branch
 */
export interface CreateBranchData {
  id?: string;
  conversationId: string;
  parentMessageId: string;
  type: BranchType;
  inheritContext: boolean;
  metadata?: SubagentBranchMetadata | HumanBranchMetadata;
}

/**
 * Data for creating a branch message
 */
export interface CreateBranchMessageData {
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  timestamp?: number;
  state?: string;
  toolCalls?: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
    name?: string;
    parameters?: Record<string, unknown>;
    result?: unknown;
    success?: boolean;
    error?: string;
  }>;
  toolCallId?: string;
  reasoning?: string;
}

/**
 * Data for updating a branch message
 */
export interface UpdateBranchMessageData {
  content?: string;
  state?: string;
  reasoning?: string;
  toolCalls?: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
    result?: unknown;
    success?: boolean;
    error?: string;
  }>;
  toolCallId?: string;
}

/**
 * Branch data as stored in SQLite
 */
export interface BranchData {
  id: string;
  conversationId: string;
  parentMessageId: string;
  type: BranchType;
  inheritContext: boolean;
  metadata?: SubagentBranchMetadata | HumanBranchMetadata;
  created: number;
  updated: number;
}

/**
 * Branch message data as stored in SQLite
 */
export interface BranchMessageData {
  id: string;
  branchId: string;
  conversationId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  timestamp: number;
  state?: string;
  toolCalls?: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
    name?: string;
    parameters?: Record<string, unknown>;
    result?: unknown;
    success?: boolean;
    error?: string;
  }>;
  toolCallId?: string;
  reasoning?: string;
  sequenceNumber: number;
}

/**
 * Branch repository implementation
 *
 * Manages branches and branch messages with append-only JSONL writes.
 * This eliminates race conditions when multiple devices create/update branches.
 */
export class BranchRepository extends BaseRepository<BranchData> {
  protected readonly tableName = 'branches';
  protected readonly entityType = 'branch';

  protected jsonlPath(conversationId: string): string {
    return `conversations/conv_${conversationId}.jsonl`;
  }

  constructor(deps: RepositoryDependencies) {
    super(deps);
  }

  // ============================================================================
  // Abstract method implementations
  // ============================================================================

  protected rowToEntity(row: any): BranchData {
    return this.rowToBranch(row);
  }

  async getById(id: string): Promise<BranchData | null> {
    const row = await this.sqliteCache.queryOne<any>(
      `SELECT * FROM ${this.tableName} WHERE id = ?`,
      [id]
    );
    return row ? this.rowToBranch(row) : null;
  }

  async getAll(options?: PaginationParams): Promise<PaginatedResult<BranchData>> {
    const page = options?.page ?? 0;
    const pageSize = Math.min(options?.pageSize ?? 50, 200);

    const countResult = await this.sqliteCache.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.tableName}`,
      []
    );
    const totalItems = countResult?.count ?? 0;

    const rows = await this.sqliteCache.query<any>(
      `SELECT * FROM ${this.tableName}
       ORDER BY created DESC
       LIMIT ? OFFSET ?`,
      [pageSize, page * pageSize]
    );

    return {
      items: rows.map((r: any) => this.rowToBranch(r)),
      page,
      pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pageSize),
      hasNextPage: (page + 1) * pageSize < totalItems,
      hasPreviousPage: page > 0
    };
  }

  async create(data: CreateBranchData): Promise<string> {
    return this.createBranch(data);
  }

  async update(id: string, data: Partial<{ metadata: SubagentBranchMetadata | HumanBranchMetadata }>): Promise<void> {
    return this.updateBranch(id, data.metadata);
  }

  async delete(id: string): Promise<void> {
    // Delete branch messages first
    await this.sqliteCache.run(`DELETE FROM branch_messages WHERE branchId = ?`, [id]);
    // Delete branch
    await this.sqliteCache.run(`DELETE FROM ${this.tableName} WHERE id = ?`, [id]);
    this.invalidateCache();
  }

  async count(criteria?: Record<string, any>): Promise<number> {
    if (criteria?.conversationId) {
      const result = await this.sqliteCache.queryOne<{ count: number }>(
        `SELECT COUNT(*) as count FROM ${this.tableName} WHERE conversationId = ?`,
        [criteria.conversationId]
      );
      return result?.count ?? 0;
    }
    const result = await this.sqliteCache.queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${this.tableName}`,
      []
    );
    return result?.count ?? 0;
  }

  // ============================================================================
  // Branch Operations
  // ============================================================================

  /**
   * Create a new branch on a message
   */
  async createBranch(data: CreateBranchData): Promise<string> {
    const id = data.id || this.generateId();
    const now = Date.now();

    try {
      // 1. Write branch_created event to JSONL
      await this.writeEvent<BranchCreatedEvent>(
        this.jsonlPath(data.conversationId),
        {
          type: 'branch_created',
          conversationId: data.conversationId,
          parentMessageId: data.parentMessageId,
          data: {
            id,
            type: data.type,
            inheritContext: data.inheritContext,
            metadataJson: data.metadata ? JSON.stringify(data.metadata) : undefined
          }
        }
      );

      // 2. Insert into SQLite cache
      await this.sqliteCache.run(
        `INSERT INTO ${this.tableName}
         (id, conversationId, parentMessageId, type, inheritContext, metadataJson, created, updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.conversationId,
          data.parentMessageId,
          data.type,
          data.inheritContext ? 1 : 0,
          data.metadata ? JSON.stringify(data.metadata) : null,
          now,
          now
        ]
      );

      this.invalidateCache();
      return id;

    } catch (error) {
      console.error('[BranchRepository] Failed to create branch:', error);
      throw error;
    }
  }

  /**
   * Update branch metadata (e.g., subagent state transitions)
   */
  async updateBranch(branchId: string, metadata?: SubagentBranchMetadata | HumanBranchMetadata): Promise<void> {
    try {
      // Get branch to find conversation ID
      const branch = await this.getById(branchId);
      if (!branch) {
        throw new Error(`Branch ${branchId} not found`);
      }

      const now = Date.now();

      // 1. Write branch_updated event to JSONL
      await this.writeEvent<BranchUpdatedEvent>(
        this.jsonlPath(branch.conversationId),
        {
          type: 'branch_updated',
          conversationId: branch.conversationId,
          branchId,
          data: {
            metadataJson: metadata ? JSON.stringify(metadata) : undefined,
            updated: now
          }
        }
      );

      // 2. Update SQLite cache
      const setClauses: string[] = ['updated = ?'];
      const params: any[] = [now];

      if (metadata !== undefined) {
        setClauses.push('metadataJson = ?');
        params.push(JSON.stringify(metadata));
      }

      params.push(branchId);
      await this.sqliteCache.run(
        `UPDATE ${this.tableName} SET ${setClauses.join(', ')} WHERE id = ?`,
        params
      );

      this.invalidateCache();

    } catch (error) {
      console.error('[BranchRepository] Failed to update branch:', error);
      throw error;
    }
  }

  /**
   * Get all branches for a conversation
   */
  async getBranchesByConversation(conversationId: string): Promise<BranchData[]> {
    const rows = await this.sqliteCache.query<any>(
      `SELECT * FROM ${this.tableName} WHERE conversationId = ? ORDER BY created ASC`,
      [conversationId]
    );
    return rows.map((r: any) => this.rowToBranch(r));
  }

  /**
   * Get all branches attached to a specific message
   */
  async getBranchesByMessage(parentMessageId: string): Promise<BranchData[]> {
    const rows = await this.sqliteCache.query<any>(
      `SELECT * FROM ${this.tableName} WHERE parentMessageId = ? ORDER BY created ASC`,
      [parentMessageId]
    );
    return rows.map((r: any) => this.rowToBranch(r));
  }

  /**
   * Get subagent branches for a conversation (for UI status display)
   */
  async getSubagentBranches(conversationId: string): Promise<BranchData[]> {
    const rows = await this.sqliteCache.query<any>(
      `SELECT * FROM ${this.tableName} WHERE conversationId = ? AND type = 'subagent' ORDER BY created DESC`,
      [conversationId]
    );
    return rows.map((r: any) => this.rowToBranch(r));
  }

  // ============================================================================
  // Branch Message Operations
  // ============================================================================

  /**
   * Add a message to a branch
   */
  async addBranchMessage(
    conversationId: string,
    branchId: string,
    data: CreateBranchMessageData
  ): Promise<string> {
    const id = data.id || this.generateId();
    const now = data.timestamp ?? Date.now();

    try {
      // Get next sequence number for this branch
      const seqResult = await this.sqliteCache.queryOne<{ maxSeq: number }>(
        `SELECT MAX(sequenceNumber) as maxSeq FROM branch_messages WHERE branchId = ?`,
        [branchId]
      );
      const sequenceNumber = (seqResult?.maxSeq ?? -1) + 1;

      // 1. Write branch_message event to JSONL
      await this.writeEvent<BranchMessageEvent>(
        this.jsonlPath(conversationId),
        {
          type: 'branch_message',
          conversationId,
          branchId,
          data: {
            id,
            role: data.role,
            content: data.content,
            tool_calls: data.toolCalls?.map(tc => ({
              id: tc.id,
              type: tc.type || 'function',
              function: tc.function,
              name: tc.name,
              parameters: tc.parameters,
              result: tc.result,
              success: tc.success,
              error: tc.error
            })),
            tool_call_id: data.toolCallId,
            state: data.state,
            reasoning: data.reasoning,
            sequenceNumber
          }
        }
      );

      // 2. Insert into SQLite cache
      await this.sqliteCache.run(
        `INSERT INTO branch_messages
         (id, branchId, conversationId, role, content, timestamp, state, toolCallsJson, toolCallId, reasoningContent, sequenceNumber)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          branchId,
          conversationId,
          data.role,
          data.content,
          now,
          data.state ?? 'complete',
          data.toolCalls ? JSON.stringify(data.toolCalls) : null,
          data.toolCallId ?? null,
          data.reasoning ?? null,
          sequenceNumber
        ]
      );

      // 3. Update branch's updated timestamp
      await this.sqliteCache.run(
        `UPDATE ${this.tableName} SET updated = ? WHERE id = ?`,
        [now, branchId]
      );

      this.invalidateCache();
      return id;

    } catch (error) {
      console.error('[BranchRepository] Failed to add branch message:', error);
      throw error;
    }
  }

  /**
   * Update a branch message (for streaming, state changes)
   */
  async updateBranchMessage(
    conversationId: string,
    branchId: string,
    messageId: string,
    data: UpdateBranchMessageData
  ): Promise<void> {
    try {
      const now = Date.now();

      // 1. Write branch_message_updated event to JSONL
      await this.writeEvent<BranchMessageUpdatedEvent>(
        this.jsonlPath(conversationId),
        {
          type: 'branch_message_updated',
          conversationId,
          branchId,
          messageId,
          data: {
            content: data.content,
            state: data.state,
            reasoning: data.reasoning,
            tool_calls: data.toolCalls?.map(tc => ({
              id: tc.id,
              type: tc.type || 'function',
              function: tc.function,
              result: tc.result,
              success: tc.success,
              error: tc.error
            })),
            tool_call_id: data.toolCallId
          }
        }
      );

      // 2. Update SQLite cache
      const setClauses: string[] = [];
      const params: any[] = [];

      if (data.content !== undefined) {
        setClauses.push('content = ?');
        params.push(data.content);
      }
      if (data.state !== undefined) {
        setClauses.push('state = ?');
        params.push(data.state);
      }
      if (data.reasoning !== undefined) {
        setClauses.push('reasoningContent = ?');
        params.push(data.reasoning);
      }
      if (data.toolCalls !== undefined) {
        setClauses.push('toolCallsJson = ?');
        params.push(data.toolCalls ? JSON.stringify(data.toolCalls) : null);
      }
      if (data.toolCallId !== undefined) {
        setClauses.push('toolCallId = ?');
        params.push(data.toolCallId);
      }

      if (setClauses.length > 0) {
        params.push(messageId);
        await this.sqliteCache.run(
          `UPDATE branch_messages SET ${setClauses.join(', ')} WHERE id = ?`,
          params
        );
      }

      // 3. Update branch's updated timestamp
      await this.sqliteCache.run(
        `UPDATE ${this.tableName} SET updated = ? WHERE id = ?`,
        [now, branchId]
      );

      this.invalidateCache();

    } catch (error) {
      console.error('[BranchRepository] Failed to update branch message:', error);
      throw error;
    }
  }

  /**
   * Get all messages for a branch (ordered by sequence number)
   */
  async getBranchMessages(branchId: string): Promise<BranchMessageData[]> {
    const rows = await this.sqliteCache.query<any>(
      `SELECT * FROM branch_messages WHERE branchId = ? ORDER BY sequenceNumber ASC`,
      [branchId]
    );
    return rows.map((r: any) => this.rowToBranchMessage(r));
  }

  /**
   * Get branch with its messages (for building LLM context)
   */
  async getBranchWithMessages(branchId: string): Promise<{
    branch: BranchData;
    messages: BranchMessageData[];
  } | null> {
    const branch = await this.getById(branchId);
    if (!branch) {
      return null;
    }

    const messages = await this.getBranchMessages(branchId);
    return { branch, messages };
  }

  /**
   * Convert branch to ConversationBranch format (for compatibility with BranchService)
   */
  async toConversationBranch(branchId: string): Promise<ConversationBranch | null> {
    const result = await this.getBranchWithMessages(branchId);
    if (!result) {
      return null;
    }

    const { branch, messages } = result;

    return {
      id: branch.id,
      type: branch.type,
      inheritContext: branch.inheritContext,
      messages: messages.map(m => this.branchMessageToChatMessage(m)),
      created: branch.created,
      updated: branch.updated,
      metadata: branch.metadata
    };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  /**
   * Convert SQLite row to BranchData
   */
  private rowToBranch(row: any): BranchData {
    return {
      id: row.id,
      conversationId: row.conversationId,
      parentMessageId: row.parentMessageId,
      type: row.type as BranchType,
      inheritContext: row.inheritContext === 1,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
      created: row.created,
      updated: row.updated
    };
  }

  /**
   * Convert SQLite row to BranchMessageData
   */
  private rowToBranchMessage(row: any): BranchMessageData {
    return {
      id: row.id,
      branchId: row.branchId,
      conversationId: row.conversationId,
      role: row.role,
      content: row.content,
      timestamp: row.timestamp,
      state: row.state ?? 'complete',
      toolCalls: row.toolCallsJson ? JSON.parse(row.toolCallsJson) : undefined,
      toolCallId: row.toolCallId ?? undefined,
      reasoning: row.reasoningContent ?? undefined,
      sequenceNumber: row.sequenceNumber
    };
  }

  /**
   * Convert BranchMessageData to ChatMessage format
   */
  private branchMessageToChatMessage(msg: BranchMessageData): ChatMessage {
    // Map storage state to ChatMessage state
    // Storage uses: 'pending', 'running', 'complete', 'cancelled', 'error', 'draft'
    // ChatMessage uses: 'draft', 'streaming', 'complete', 'aborted', 'invalid'
    let state: ChatMessage['state'];
    switch (msg.state) {
      case 'streaming':
      case 'running':
        state = 'streaming';
        break;
      case 'draft':
        state = 'draft';
        break;
      case 'complete':
        state = 'complete';
        break;
      case 'cancelled':
      case 'aborted':
        state = 'aborted';
        break;
      case 'error':
      case 'invalid':
        state = 'invalid';
        break;
      default:
        state = 'complete';
    }

    return {
      id: msg.id,
      conversationId: msg.conversationId,
      role: msg.role as 'user' | 'assistant' | 'tool',
      content: msg.content ?? '',
      timestamp: msg.timestamp,
      state,
      toolCalls: msg.toolCalls?.map(tc => ({
        id: tc.id,
        type: tc.type || 'function',
        name: tc.name || tc.function?.name || 'unknown',
        function: tc.function,
        parameters: tc.parameters || {},
        result: tc.result,
        success: tc.success,
        error: tc.error
      })),
      reasoning: msg.reasoning
    };
  }
}
