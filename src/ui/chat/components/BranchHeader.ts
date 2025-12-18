/**
 * BranchHeader - Navigation header when viewing a branch
 *
 * Displays above the message list when user navigates into a subagent or human branch.
 * Shows:
 * - Back button to return to parent conversation
 * - Branch task/description
 * - Status badge (running, complete, paused, etc.)
 *
 * Uses Obsidian's setIcon helper for consistent iconography.
 */

import { setIcon, Component } from 'obsidian';
import type { BranchState, SubagentBranchMetadata } from '../../../types/branch/BranchTypes';

export interface BranchViewContext {
  conversationId: string;
  branchId: string;
  parentMessageId: string;
  branchType: 'human' | 'subagent';
  metadata?: SubagentBranchMetadata;
}

export interface BranchHeaderCallbacks {
  onNavigateToParent: () => void;
  onCancel?: (subagentId: string) => void;
  onContinue?: (branchId: string) => void;
}

export class BranchHeader {
  private element: HTMLElement | null = null;
  private context: BranchViewContext | null = null;

  constructor(
    private container: HTMLElement,
    private callbacks: BranchHeaderCallbacks,
    private component?: Component
  ) {}

  /**
   * Show the branch header with the given context
   */
  show(context: BranchViewContext): void {
    this.context = context;
    this.render();
  }

  /**
   * Hide the branch header
   */
  hide(): void {
    this.context = null;
    if (this.element) {
      this.element.remove();
      this.element = null;
    }
  }

  /**
   * Update the context (e.g., when iteration count changes)
   */
  update(context: Partial<BranchViewContext>): void {
    if (!this.context) return;
    this.context = { ...this.context, ...context };
    this.render();
  }

  /**
   * Check if header is currently visible
   */
  isVisible(): boolean {
    return this.element !== null;
  }

  /**
   * Get current branch context
   */
  getContext(): BranchViewContext | null {
    return this.context;
  }

  /**
   * Render the header
   */
  private render(): void {
    if (!this.context) return;

    // Remove existing element if any
    if (this.element) {
      this.element.remove();
    }

    const header = document.createElement('div');
    header.addClass('nexus-branch-header');

    // Back button
    const backBtn = header.createEl('button', {
      cls: 'nexus-branch-back clickable-icon',
    });
    const backIcon = backBtn.createSpan('nexus-branch-back-icon');
    setIcon(backIcon, 'arrow-left');
    backBtn.createSpan({ text: ' Back' });

    if (this.component) {
      this.component.registerDomEvent(backBtn, 'click', () => {
        this.callbacks.onNavigateToParent();
      });
    } else {
      backBtn.addEventListener('click', () => {
        this.callbacks.onNavigateToParent();
      });
    }

    // Branch info container
    const info = header.createDiv('nexus-branch-info');

    // Branch task/description
    if (this.context.branchType === 'subagent' && this.context.metadata) {
      const task = this.context.metadata.task || 'Subagent';
      const taskEl = info.createSpan({
        text: `Subagent: "${this.truncateTask(task)}"`,
        cls: 'nexus-branch-task',
      });
      taskEl.setAttribute('title', task);

      // Status badge
      const statusContainer = info.createSpan('nexus-branch-status');
      const statusText = this.getStatusText(this.context.metadata);
      const statusIcon = this.getStatusIcon(this.context.metadata.state);

      statusContainer.createSpan({
        text: statusText,
        cls: `nexus-status-text nexus-status-${this.context.metadata.state || 'running'}`,
      });
      statusContainer.createSpan({ text: ` ${statusIcon}` });

      // Action buttons for running/paused agents
      if (this.context.metadata.state === 'running' && this.callbacks.onCancel && this.context.metadata.subagentId) {
        const cancelBtn = header.createEl('button', {
          cls: 'nexus-branch-action-btn nexus-branch-cancel-btn clickable-icon',
          text: 'Cancel',
        });
        const subagentId = this.context.metadata.subagentId;
        if (this.component) {
          this.component.registerDomEvent(cancelBtn, 'click', () => {
            this.callbacks.onCancel!(subagentId);
          });
        } else {
          cancelBtn.addEventListener('click', () => {
            this.callbacks.onCancel!(subagentId);
          });
        }
      }

      if (this.context.metadata.state === 'max_iterations' && this.callbacks.onContinue) {
        const continueBtn = header.createEl('button', {
          cls: 'nexus-branch-action-btn nexus-branch-continue-btn mod-cta',
          text: 'Continue',
        });
        const branchId = this.context.branchId;
        if (this.component) {
          this.component.registerDomEvent(continueBtn, 'click', () => {
            this.callbacks.onContinue!(branchId);
          });
        } else {
          continueBtn.addEventListener('click', () => {
            this.callbacks.onContinue!(branchId);
          });
        }
      }
    } else {
      // Human branch
      info.createSpan({
        text: 'Alternative Branch',
        cls: 'nexus-branch-task',
      });
    }

    this.element = header;
    this.container.prepend(header);
  }

  /**
   * Get status text for the badge
   */
  private getStatusText(metadata: SubagentBranchMetadata): string {
    const { state, iterations } = metadata;

    switch (state) {
      case 'running':
        return `Running ${iterations || 0}/${metadata.maxIterations || 10}`;
      case 'complete':
        return `Complete (${iterations || 0} iterations)`;
      case 'cancelled':
        return 'Cancelled';
      case 'max_iterations':
        return `Paused ${iterations || 0}/${metadata.maxIterations || 10}`;
      case 'abandoned':
        return 'Abandoned';
      default:
        return '';
    }
  }

  /**
   * Get status icon
   */
  private getStatusIcon(state?: BranchState): string {
    switch (state) {
      case 'running':
        return '🔄';
      case 'complete':
        return '✓';
      case 'cancelled':
        return '✗';
      case 'max_iterations':
        return '⏸';
      case 'abandoned':
        return '⚠️';
      default:
        return '';
    }
  }

  /**
   * Truncate long task descriptions
   */
  private truncateTask(task: string, maxLength: number = 50): string {
    if (task.length <= maxLength) return task;
    return task.substring(0, maxLength - 3) + '...';
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.hide();
  }
}
