/**
 * Location: src/database/storage/SQLiteSearchService.ts
 *
 * Full-text search service using SQLite FTS4.
 * Extracted from SQLiteCacheManager for single responsibility.
 */

export interface IQueryExecutor {
  query<T>(sql: string, params?: any[]): Promise<T[]>;
}

export class SQLiteSearchService {
  private queryExecutor: IQueryExecutor;

  constructor(queryExecutor: IQueryExecutor) {
    this.queryExecutor = queryExecutor;
  }

  /**
   * Search workspaces using FTS4
   */
  async searchWorkspaces(query: string, limit: number = 50): Promise<any[]> {
    return this.queryExecutor.query(
      `SELECT w.* FROM workspaces w
       JOIN workspace_fts fts ON w.id = fts.id
       WHERE workspace_fts MATCH ?
       ORDER BY w.lastAccessed DESC
       LIMIT ?`,
      [query, limit]
    );
  }

  /**
   * Search conversations using FTS4
   */
  async searchConversations(query: string, limit: number = 50): Promise<any[]> {
    return this.queryExecutor.query(
      `SELECT c.* FROM conversations c
       JOIN conversation_fts fts ON c.id = fts.id
       WHERE conversation_fts MATCH ?
       ORDER BY c.updated DESC
       LIMIT ?`,
      [query, limit]
    );
  }

  /**
   * Search messages using FTS4
   */
  async searchMessages(query: string, limit: number = 50): Promise<any[]> {
    return this.queryExecutor.query(
      `SELECT m.* FROM messages m
       JOIN message_fts fts ON m.id = fts.id
       WHERE message_fts MATCH ?
       ORDER BY m.timestamp DESC
       LIMIT ?`,
      [query, limit]
    );
  }

  /**
   * Search messages within a specific conversation using FTS4
   */
  async searchMessagesInConversation(conversationId: string, query: string, limit: number = 50): Promise<any[]> {
    return this.queryExecutor.query(
      `SELECT m.* FROM messages m
       JOIN message_fts fts ON m.id = fts.id
       WHERE fts.conversationId = ? AND message_fts MATCH ?
       ORDER BY m.timestamp DESC
       LIMIT ?`,
      [conversationId, query, limit]
    );
  }
}
