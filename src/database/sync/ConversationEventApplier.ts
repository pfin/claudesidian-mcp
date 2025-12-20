/**
 * Location: src/database/sync/ConversationEventApplier.ts
 *
 * Applies conversation-related events to SQLite cache.
 * Handles: conversation, message events.
 */

import {
  ConversationEvent,
  ConversationCreatedEvent,
  ConversationUpdatedEvent,
  MessageEvent,
  MessageUpdatedEvent,
  BranchCreatedEvent,
  BranchMessageEvent,
  BranchMessageUpdatedEvent,
  BranchUpdatedEvent,
} from '../interfaces/StorageEvents';
import { ISQLiteCacheManager } from './SyncCoordinator';

export class ConversationEventApplier {
  private sqliteCache: ISQLiteCacheManager;

  constructor(sqliteCache: ISQLiteCacheManager) {
    this.sqliteCache = sqliteCache;
  }

  /**
   * Apply a conversation-related event to SQLite cache.
   */
  async apply(event: ConversationEvent): Promise<void> {
    switch (event.type) {
      case 'metadata':
        await this.applyConversationCreated(event);
        break;
      case 'conversation_updated':
        await this.applyConversationUpdated(event);
        break;
      case 'message':
        await this.applyMessageAdded(event);
        break;
      case 'message_updated':
        await this.applyMessageUpdated(event);
        break;
      case 'branch_created':
        await this.applyBranchCreated(event);
        break;
      case 'branch_message':
        await this.applyBranchMessageAdded(event);
        break;
      case 'branch_message_updated':
        await this.applyBranchMessageUpdated(event);
        break;
      case 'branch_updated':
        await this.applyBranchUpdated(event);
        break;
    }
  }

  private async applyConversationCreated(event: ConversationCreatedEvent): Promise<void> {
    // Skip invalid conversation events
    if (!event.data?.id) {
      return;
    }

    await this.sqliteCache.run(
      `INSERT OR REPLACE INTO conversations
       (id, title, created, updated, vaultName, messageCount, metadataJson)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        event.data.id,
        event.data.title ?? 'Untitled',
        event.data.created ?? Date.now(),
        event.data.created ?? Date.now(),
        event.data.vault ?? '',
        0,
        event.data.settings ? JSON.stringify(event.data.settings) : null
      ]
    );
  }

  private async applyConversationUpdated(event: ConversationUpdatedEvent): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (event.data.title !== undefined) { updates.push('title = ?'); values.push(event.data.title); }
    if (event.data.updated !== undefined) { updates.push('updated = ?'); values.push(event.data.updated); }
    if (event.data.settings !== undefined) { updates.push('metadataJson = ?'); values.push(JSON.stringify(event.data.settings)); }

    if (updates.length > 0) {
      values.push(event.conversationId);
      await this.sqliteCache.run(
        `UPDATE conversations SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }
  }

  private async applyMessageAdded(event: MessageEvent): Promise<void> {
    // Skip invalid message events
    if (!event.data?.id || !event.conversationId) {
      return;
    }

    await this.sqliteCache.run(
      `INSERT OR REPLACE INTO messages
       (id, conversationId, role, content, timestamp, state, toolCallsJson, toolCallId, reasoningContent, sequenceNumber, alternativesJson, activeAlternativeIndex)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.data.id,
        event.conversationId,
        event.data.role ?? 'user',
        event.data.content ?? '',
        event.timestamp ?? Date.now(),
        event.data.state ?? 'complete',
        event.data.tool_calls ? JSON.stringify(event.data.tool_calls) : null,
        event.data.tool_call_id ?? null,
        event.data.reasoning ?? null,
        event.data.sequenceNumber ?? 0,
        event.data.alternatives ? JSON.stringify(event.data.alternatives) : null,
        event.data.activeAlternativeIndex ?? 0
      ]
    );

    // Update message count
    await this.sqliteCache.run(
      `UPDATE conversations SET messageCount = messageCount + 1, updated = ? WHERE id = ?`,
      [event.timestamp ?? Date.now(), event.conversationId]
    );
  }

  private async applyMessageUpdated(event: MessageUpdatedEvent): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (event.data.content !== undefined) { updates.push('content = ?'); values.push(event.data.content); }
    if (event.data.state !== undefined) { updates.push('state = ?'); values.push(event.data.state); }
    if (event.data.reasoning !== undefined) { updates.push('reasoningContent = ?'); values.push(event.data.reasoning); }
    if (event.data.tool_calls !== undefined) {
      updates.push('toolCallsJson = ?');
      values.push(event.data.tool_calls ? JSON.stringify(event.data.tool_calls) : null);
    }
    if (event.data.tool_call_id !== undefined) {
      updates.push('toolCallId = ?');
      values.push(event.data.tool_call_id);
    }
    if (event.data.alternatives !== undefined) {
      updates.push('alternativesJson = ?');
      values.push(event.data.alternatives ? JSON.stringify(event.data.alternatives) : null);
    }
    if (event.data.activeAlternativeIndex !== undefined) {
      updates.push('activeAlternativeIndex = ?');
      values.push(event.data.activeAlternativeIndex);
    }

    if (updates.length > 0) {
      values.push(event.messageId);
      await this.sqliteCache.run(
        `UPDATE messages SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }
  }

  // ============================================================================
  // Branch Event Handlers
  // ============================================================================

  private async applyBranchCreated(event: BranchCreatedEvent): Promise<void> {
    // Skip invalid branch events
    if (!event.data?.id || !event.conversationId || !event.parentMessageId) {
      return;
    }

    await this.sqliteCache.run(
      `INSERT OR REPLACE INTO branches
       (id, conversationId, parentMessageId, type, inheritContext, metadataJson, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.data.id,
        event.conversationId,
        event.parentMessageId,
        event.data.type ?? 'human',
        event.data.inheritContext ? 1 : 0,
        event.data.metadataJson ?? null,
        event.timestamp ?? Date.now(),
        event.timestamp ?? Date.now()
      ]
    );
  }

  private async applyBranchMessageAdded(event: BranchMessageEvent): Promise<void> {
    // Skip invalid branch message events
    if (!event.data?.id || !event.branchId || !event.conversationId) {
      return;
    }

    await this.sqliteCache.run(
      `INSERT OR REPLACE INTO branch_messages
       (id, branchId, conversationId, role, content, timestamp, state, toolCallsJson, toolCallId, reasoningContent, sequenceNumber)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.data.id,
        event.branchId,
        event.conversationId,
        event.data.role ?? 'user',
        event.data.content ?? '',
        event.timestamp ?? Date.now(),
        event.data.state ?? 'complete',
        event.data.tool_calls ? JSON.stringify(event.data.tool_calls) : null,
        event.data.tool_call_id ?? null,
        event.data.reasoning ?? null,
        event.data.sequenceNumber ?? 0
      ]
    );

    // Update branch's updated timestamp
    await this.sqliteCache.run(
      `UPDATE branches SET updated = ? WHERE id = ?`,
      [event.timestamp ?? Date.now(), event.branchId]
    );
  }

  private async applyBranchMessageUpdated(event: BranchMessageUpdatedEvent): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (event.data.content !== undefined) { updates.push('content = ?'); values.push(event.data.content); }
    if (event.data.state !== undefined) { updates.push('state = ?'); values.push(event.data.state); }
    if (event.data.reasoning !== undefined) { updates.push('reasoningContent = ?'); values.push(event.data.reasoning); }
    if (event.data.tool_calls !== undefined) {
      updates.push('toolCallsJson = ?');
      values.push(event.data.tool_calls ? JSON.stringify(event.data.tool_calls) : null);
    }
    if (event.data.tool_call_id !== undefined) {
      updates.push('toolCallId = ?');
      values.push(event.data.tool_call_id);
    }

    if (updates.length > 0) {
      values.push(event.messageId);
      await this.sqliteCache.run(
        `UPDATE branch_messages SET ${updates.join(', ')} WHERE id = ?`,
        values
      );

      // Update branch's updated timestamp
      await this.sqliteCache.run(
        `UPDATE branches SET updated = ? WHERE id = ?`,
        [event.timestamp ?? Date.now(), event.branchId]
      );
    }
  }

  private async applyBranchUpdated(event: BranchUpdatedEvent): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (event.data.metadataJson !== undefined) {
      updates.push('metadataJson = ?');
      values.push(event.data.metadataJson);
    }
    if (event.data.updated !== undefined) {
      updates.push('updated = ?');
      values.push(event.data.updated);
    } else {
      // Always update the timestamp
      updates.push('updated = ?');
      values.push(event.timestamp ?? Date.now());
    }

    if (updates.length > 0) {
      values.push(event.branchId);
      await this.sqliteCache.run(
        `UPDATE branches SET ${updates.join(', ')} WHERE id = ?`,
        values
      );
    }
  }
}
