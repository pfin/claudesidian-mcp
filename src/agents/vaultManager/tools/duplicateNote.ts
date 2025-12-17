import { App } from 'obsidian';
import { BaseTool } from '../../baseTool';
import { DuplicateNoteParams, DuplicateNoteResult } from '../types';
import { FileOperations } from '../utils/FileOperations';
import { createErrorMessage } from '../../../utils/errorUtils';
import { addRecommendations, Recommendation } from '../../../utils/recommendationUtils';
import { NudgeHelpers } from '../../../utils/nudgeHelpers';

/**
 * Tool for duplicating a note
 */
export class DuplicateNoteTool extends BaseTool<DuplicateNoteParams, DuplicateNoteResult> {
  private app: App;

  /**
   * Create a new DuplicateNoteTool
   * @param app Obsidian app instance
   */
  constructor(app: App) {
    super(
      'duplicateNote',
      'Duplicate Note',
      'Create a duplicate of an existing note',
      '1.0.0'
    );

    this.app = app;
  }

  /**
   * Execute the tool
   * @param params Tool parameters
   * @returns Promise that resolves with the result of duplicating the note
   */
  async execute(params: DuplicateNoteParams): Promise<DuplicateNoteResult> {
    try {
      // Validate parameters
      if (!params.sourcePath) {
        return this.prepareResult(false, undefined, 'Source path is required');
      }

      if (!params.targetPath) {
        return this.prepareResult(false, undefined, 'Target path is required');
      }

      // Perform the duplication
      const result = await FileOperations.duplicateNote(
        this.app,
        params.sourcePath,
        params.targetPath,
        params.overwrite || false,
        params.autoIncrement || false
      );

      const response = this.prepareResult(true, {
        sourcePath: result.sourcePath,
        targetPath: result.targetPath,
        wasAutoIncremented: result.wasAutoIncremented,
        wasOverwritten: result.wasOverwritten
      });

      // Generate nudges for duplicate operations
      const nudges = this.generateDuplicateNudges();

      return addRecommendations(response, nudges);
    } catch (error) {
      return this.prepareResult(false, undefined, createErrorMessage('Failed to duplicate note: ', error));
    }
  }

  /**
   * Get the JSON schema for the tool's parameters
   * @returns JSON schema object
   */
  getParameterSchema(): any {
    // Create the tool-specific schema
    const toolSchema = {
      type: 'object',
      properties: {
        sourcePath: {
          type: 'string',
          description: 'Path to the source note to duplicate (REQUIRED)'
        },
        targetPath: {
          type: 'string',
          description: 'Path for the duplicate note (REQUIRED)'
        },
        overwrite: {
          type: 'boolean',
          description: 'Whether to overwrite if target already exists',
          default: false
        },
        autoIncrement: {
          type: 'boolean',
          description: 'Whether to auto-increment filename if target exists (takes precedence over overwrite)',
          default: false
        }
      },
      required: ['sourcePath', 'targetPath']
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
        sourcePath: {
          type: 'string',
          description: 'Path of the source note'
        },
        targetPath: {
          type: 'string',
          description: 'Final path of the duplicated note'
        },
        wasAutoIncremented: {
          type: 'boolean',
          description: 'Whether the filename was auto-incremented due to conflicts'
        },
        wasOverwritten: {
          type: 'boolean',
          description: 'Whether an existing file was overwritten'
        }
      }
    };

    return baseSchema;
  }

  /**
   * Generate nudges for duplicate operations
   */
  private generateDuplicateNudges(): Recommendation[] {
    const nudges: Recommendation[] = [];

    // Always suggest customization after duplicating files
    nudges.push(NudgeHelpers.suggestCustomization());

    return nudges;
  }
}
