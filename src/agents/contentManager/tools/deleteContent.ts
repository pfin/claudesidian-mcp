import { App } from 'obsidian';
import { BaseTool } from '../../baseTool';
import { DeleteContentParams, DeleteContentResult } from '../types';
import { ContentOperations } from '../utils/ContentOperations';
import { createErrorMessage } from '../../../utils/errorUtils';

/**
 * Tool for deleting content from a file
 * Follows Single Responsibility Principle - only handles content deletion
 * File change detection are handled automatically by FileEventManager
 */
export class DeleteContentTool extends BaseTool<DeleteContentParams, DeleteContentResult> {
  private app: App;

  /**
   * Create a new DeleteContentTool
   * @param app Obsidian app instance
   */
  constructor(app: App) {
    super(
      'deleteContent',
      'Delete Content',
      'Delete content from a file in the vault',
      '1.0.0'
    );

    this.app = app;
  }
  
  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise that resolves with the delete result
   */
  async execute(params: DeleteContentParams): Promise<DeleteContentResult> {
    try {
      const { filePath, content, similarityThreshold = 0.95, workspaceContext } = params;
      
      const deletions = await ContentOperations.deleteContent(
        this.app,
        filePath,
        content,
        similarityThreshold
      );
      
      // File change detection are handled automatically by FileEventManager
      
      const resultData = {
        filePath,
        deletions
      };

      const response = this.prepareResult(true, resultData);

      return response;
    } catch (error) {
      return this.prepareResult(false, undefined, createErrorMessage('Error deleting content: ', error));
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
          description: 'Path to the file to modify'
        },
        content: {
          type: 'string',
          description: 'Content to delete'
        },
        similarityThreshold: {
          type: 'number',
          description: 'Threshold for fuzzy matching (0.0 to 1.0, where 1.0 is exact match)',
          default: 0.95,
          minimum: 0.0,
          maximum: 1.0
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
            deletions: {
              type: 'number',
              description: 'Number of deletions made'
            }
          },
          required: ['filePath', 'deletions']
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
