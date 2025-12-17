import { App } from 'obsidian';
import { BaseTool } from '../../baseTool';
import { CreateFolderParams, CreateFolderResult } from '../types';
import { FileOperations } from '../utils/FileOperations';
import { createErrorMessage } from '../../../utils/errorUtils';

/**
 * Tool to create a new folder
 */
export class CreateFolderTool extends BaseTool<CreateFolderParams, CreateFolderResult> {
  private app: App;

  /**
   * Create a new CreateFolderTool
   * @param app Obsidian app instance
   */
  constructor(app: App) {
    super(
      'createFolder',
      'Create Folder',
      'Create a new folder in the vault',
      '1.0.0'
    );
    this.app = app;
  }

  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise resolving to the result
   */
  async execute(params: CreateFolderParams): Promise<CreateFolderResult> {
    try {
      // Validate parameters
      if (!params.path) {
        return this.prepareResult(false, undefined, 'Path is required');
      }

      // Create the folder using existing utility if available
      let result: { path: string; existed: boolean };

      if (typeof FileOperations?.createFolder === 'function') {
        const existed = await FileOperations.createFolder(this.app, params.path);
        result = { path: params.path, existed };
      }
      // Otherwise use default implementation
      else {
        // Check if folder already exists
        const existingFolder = this.app.vault.getAbstractFileByPath(params.path);
        if (existingFolder) {
          result = { path: params.path, existed: true };
        } else {
          // Create the folder
          await this.app.vault.createFolder(params.path);
          result = { path: params.path, existed: false };
        }
      }

      return this.prepareResult(true, result);
    } catch (error) {
      return this.prepareResult(false, undefined, createErrorMessage('Failed to create folder: ', error));
    }
  }

  /**
   * Get the parameter schema
   */
  getParameterSchema(): Record<string, any> {
    // Create the tool-specific schema
    const toolSchema = {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the folder to create (REQUIRED)'
        }
      },
      required: ['path']
    };

    // Merge with common schema (workspace context)
    return this.getMergedSchema(toolSchema);
  }

  /**
   * Get the result schema
   */
  getResultSchema(): Record<string, any> {
    const baseSchema = super.getResultSchema();

    // Extend the base schema to include our specific data
    baseSchema.properties.data = {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the created folder'
        },
        existed: {
          type: 'boolean',
          description: 'Whether the folder already existed'
        }
      }
    };

    return baseSchema;
  }
}
