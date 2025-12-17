import { App } from 'obsidian';
import { BaseTool } from '../../baseTool';
import { ReadContentParams, ReadContentResult } from '../types';
import { ContentOperations } from '../utils/ContentOperations';
import { createErrorMessage } from '../../../utils/errorUtils';
import { addRecommendations, Recommendation } from '../../../utils/recommendationUtils';
import { NudgeHelpers } from '../../../utils/nudgeHelpers';

/**
 * Tool for reading content from a file
 */
export class ReadContentTool extends BaseTool<ReadContentParams, ReadContentResult> {
  private app: App;

  /**
   * Create a new ReadContentTool
   * @param app Obsidian app instance
   */
  constructor(app: App) {
    super(
      'readContent',
      'Read Content',
      'Read content from a file in the vault',
      '1.0.0'
    );

    this.app = app;
  }
  
  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise that resolves with the file content
   */
  async execute(params: ReadContentParams): Promise<ReadContentResult> {
    try {
      const { filePath, limit, offset, includeLineNumbers, workspaceContext } = params;
      
      let content: string;
      let startLine: number | undefined;
      let endLine: number | undefined;
      
      // If both limit and offset are specified, read specific lines
      if (typeof limit === 'number' && typeof offset === 'number') {
        startLine = offset;
        endLine = offset + limit - 1;
        const lines = await ContentOperations.readLines(
          this.app,
          filePath,
          startLine,
          endLine,
          includeLineNumbers
        );
        content = lines.join('\n');
      } else if (includeLineNumbers) {
        // Read entire file with line numbers
        content = await ContentOperations.readContentWithLineNumbers(this.app, filePath);
      } else {
        // Read entire file
        content = await ContentOperations.readContent(this.app, filePath);
      }
      
      const resultData = {
        content,
        filePath,
        lineNumbersIncluded: includeLineNumbers,
        startLine,
        endLine
      };

      const result = this.prepareResult(true, resultData);

      // Generate nudges based on content
      const nudges = this.generateReadContentNudges(resultData);
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
    // Create the tool-specific schema
    const toolSchema = {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to read'
        },
        limit: {
          type: 'number',
          description: 'Optional number of lines to read'
        },
        offset: {
          type: 'number',
          description: 'Optional line number to start reading from (1-based)'
        },
        includeLineNumbers: {
          type: 'boolean',
          description: 'Whether to include line numbers in the output',
          default: false
        }
      },
      required: ['filePath']
    };

    // Merge with common schema (workspace context)
    return this.getMergedSchema(toolSchema);
  }

  getResultSchema(): Record<string, unknown> {
    // Use the base result schema from BaseTool, which includes common result properties
    const baseSchema = super.getResultSchema();

    // Add tool-specific data properties
    baseSchema.properties.data = {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'Content of the file'
        },
        filePath: {
          type: 'string',
          description: 'Path to the file'
        },
        lineNumbersIncluded: {
          type: 'boolean',
          description: 'Whether line numbers are included in the content'
        },
        startLine: {
          type: 'number',
          description: 'Starting line if offset was specified'
        },
        endLine: {
          type: 'number',
          description: 'Ending line if limit was specified'
        }
      },
      required: ['content', 'filePath']
    };
    
    return baseSchema;
  }

  /**
   * Generate nudges based on content reading results
   */
  private generateReadContentNudges(resultData: { content: string; filePath: string }): Recommendation[] {
    const nudges: Recommendation[] = [];

    // Check for large content (>7,000 characters)
    const largeContentNudge = NudgeHelpers.checkLargeContent(resultData.content.length);
    if (largeContentNudge) {
      nudges.push(largeContentNudge);
    }

    return nudges;
  }
}
