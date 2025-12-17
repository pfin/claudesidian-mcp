import { App } from 'obsidian';
import { BaseTool } from '../../baseTool';
import { PrependContentParams, PrependContentResult } from '../types';
import { ContentOperations } from '../utils/ContentOperations';
import { createErrorMessage } from '../../../utils/errorUtils';

/**
 * Tool for prepending content to a file
 */
export class PrependContentTool extends BaseTool<PrependContentParams, PrependContentResult> {
  private app: App;

  /**
   * Create a new PrependContentTool
   * @param app Obsidian app instance
   */
  constructor(app: App) {
    super(
      'prependContent',
      'Prepend Content',
      'Prepend content to a file in the vault',
      '1.0.0'
    );

    this.app = app;
  }
  
  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise that resolves with the prepend result
   */
  async execute(params: PrependContentParams): Promise<PrependContentResult> {
    try {
      const { filePath, content, workspaceContext } = params;
      
      const result = await ContentOperations.prependContent(this.app, filePath, content);
      
      // File change detection are handled automatically by FileEventManager
      
      const resultData = {
        filePath,
        prependedLength: result.prependedLength,
        totalLength: result.totalLength
      };

      const response = this.prepareResult(true, resultData);

      return response;
    } catch (error) {
      return this.prepareResult(false, undefined, createErrorMessage('Error prepending content: ', error));
    }
  }
  
  
  /**
   * Get the JSON schema for the tool's parameters
   * @returns JSON schema object
   */
  getParameterSchema(): Record<string, unknown> {
    const customSchema = {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: 'Path to the file to prepend to'
        },
        content: {
          type: 'string',
          description: 'Content to prepend to the file'
        }
      },
      required: ['filePath', 'content']
    };
    
    return this.getMergedSchema(customSchema);
  }
  
  /**
   * Get the JSON schema for the tool's result
   * @returns JSON schema object
   */
  getResultSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        success: {
          type: 'boolean',
          description: 'Whether the operation succeeded'
        },
        error: {
          type: 'string',
          description: 'Error message if success is false'
        },
        data: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Path to the file'
            },
            prependedLength: {
              type: 'number',
              description: 'Length of the content prepended'
            },
            totalLength: {
              type: 'number',
              description: 'Total length of the file after prepending'
            }
          },
          required: ['filePath', 'prependedLength', 'totalLength']
        },
        workspaceContext: {
          type: 'object',
          properties: {
            workspaceId: {
              type: 'string',
              description: 'ID of the workspace'
            },
            workspacePath: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Path of the workspace'
            },
            activeWorkspace: {
              type: 'boolean',
              description: 'Whether this is the active workspace'
            }
          }
        },
      },
      required: ['success']
    };
  }
}
