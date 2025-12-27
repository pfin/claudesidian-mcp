import { CommonParameters, CommonResult, CustomPrompt } from '../../types';

// List Agents Tool
export interface ListAgentsParams extends CommonParameters {
  enabledOnly?: boolean;
  includeArchived?: boolean;
}

export interface ListAgentsResult extends CommonResult {
  data: {
    prompts: Array<Pick<CustomPrompt, 'id' | 'name' | 'description' | 'isEnabled'>>;
    totalCount: number;
    enabledCount: number;
    message: string;
  };
}

// Get Agent Tool
export interface GetAgentParams extends CommonParameters {
  id?: string;
  name?: string;
}

export interface GetAgentResult extends CommonResult {
  data: (CustomPrompt & { message: string }) | null;
}

// Create Agent Tool
export interface CreateAgentParams extends CommonParameters {
  name: string;
  description: string;
  prompt: string;
  isEnabled?: boolean;
}

export interface CreateAgentResult extends CommonResult {
  data: CustomPrompt;
}

// Update Agent Tool
export interface UpdateAgentParams extends CommonParameters {
  id: string;
  name?: string;
  description?: string;
  prompt?: string;
  isEnabled?: boolean;
}

export interface UpdateAgentResult extends CommonResult {
  data: CustomPrompt;
}

// Archive Agent Tool
export interface ArchiveAgentParams extends CommonParameters {
  name: string;
}

export interface ArchiveAgentResult extends CommonResult {
  // Lean result - no data needed, LLM knows what it archived
}

// Delete Agent Tool (deprecated - replaced by archiveAgent)
export interface DeleteAgentParams extends CommonParameters {
  id: string;
}

export interface DeleteAgentResult extends CommonResult {
  data: {
    deleted: boolean;
    id: string;
  };
}