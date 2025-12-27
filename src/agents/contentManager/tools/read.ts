import { App } from 'obsidian';
import { BaseTool } from '../../baseTool';
import { ReadParams, ReadResult } from '../types';
import { ContentOperations } from '../utils/ContentOperations';
import { createErrorMessage } from '../../../utils/errorUtils';
import { addRecommendations, Recommendation } from '../../../utils/recommendationUtils';
import { NudgeHelpers } from '../../../utils/nudgeHelpers';

/**
 * Location: src/agents/contentManager/tools/read.ts
 *
 * Simplified read tool for ContentManager.
 * Reads content from a file with explicit line range control.
 *
 * Key Design:
 * - startLine is REQUIRED (forces intentional positioning)
 * - endLine is optional (defaults to end of file)
 * - Encourages LLMs to think about where content is located
 *
 * Relationships:
 * - Uses ContentOperations utility for file operations
 * - Part of CRUA architecture (Read operation)
 */
export class ReadTool extends BaseTool<ReadParams, ReadResult> {
  private app: App;

  /**
   * Create a new ReadTool
   * @param app Obsidian app instance
   */
  constructor(app: App) {
    super(
      'read',
      'Read',
      'Read content from a file with line range',
      '1.0.0'
    );

    this.app = app;
  }

  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise that resolves with the file content
   */
  async execute(params: ReadParams): Promise<ReadResult> {
    try {
      const { path, startLine, endLine } = params;

      let content: string;
      let actualStartLine: number;
      let actualEndLine: number | undefined;

      // If endLine is specified, read specific line range
      if (endLine !== undefined) {
        actualStartLine = startLine;
        actualEndLine = endLine;
        const lines = await ContentOperations.readLines(
          this.app,
          path,
          startLine,
          endLine,
          false // Don't include line numbers in content
        );
        content = lines.join('\n');
      } else if (startLine === 1) {
        // Read entire file from start
        content = await ContentOperations.readContent(this.app, path);
        actualStartLine = 1;
      } else {
        // Read from startLine to end of file
        const fullContent = await ContentOperations.readContent(this.app, path);
        const lines = fullContent.split('\n');
        const totalLines = lines.length;

        // Adjust for 1-based line numbers
        const startIdx = Math.max(0, startLine - 1);
        content = lines.slice(startIdx).join('\n');
        actualStartLine = startLine;
        actualEndLine = totalLines;
      }

      const resultData = {
        content,
        path,
        startLine: actualStartLine,
        endLine: actualEndLine
      };

      const result = this.prepareResult(true, resultData);

      // Generate nudges based on content
      const nudges = this.generateReadNudges(resultData);
      const resultWithNudges = addRecommendations(result, nudges);

      return resultWithNudges;
    } catch (error) {
      return this.prepareResult(false, undefined, createErrorMessage('Error reading content: ', error));
    }
  }

  /**
   * Get the JSON schema for the tool's parameters
   * @returns JSON schema object
   */
  getParameterSchema(): Record<string, unknown> {
    const toolSchema = {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to the file to read'
        },
        startLine: {
          type: 'number',
          description: 'Start line (1-based), REQUIRED - forces intentional positioning. Use 1 to read from beginning.'
        },
        endLine: {
          type: 'number',
          description: 'End line (1-based, inclusive). If omitted, reads to end of file.'
        }
      },
      required: ['path', 'startLine']
    };

    return this.getMergedSchema(toolSchema);
  }

  /**
   * Get the JSON schema for the tool's result
   * @returns JSON schema object
   */
  getResultSchema(): Record<string, unknown> {
    const baseSchema = super.getResultSchema();

    baseSchema.properties.data = {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content of the file'
        },
        path: {
          type: 'string',
          description: 'Path to the file'
        },
        startLine: {
          type: 'number',
          description: 'Starting line that was read'
        },
        endLine: {
          type: 'number',
          description: 'Ending line that was read (if applicable)'
        }
      },
      required: ['content', 'path', 'startLine']
    };

    return baseSchema;
  }

  /**
   * Generate nudges based on content reading results
   */
  private generateReadNudges(resultData: { content: string; path: string }): Recommendation[] {
    const nudges: Recommendation[] = [];

    // Check for large content (>7,000 characters)
    const largeContentNudge = NudgeHelpers.checkLargeContent(resultData.content.length);
    if (largeContentNudge) {
      nudges.push(largeContentNudge);
    }

    return nudges;
  }
}
