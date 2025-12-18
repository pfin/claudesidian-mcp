/**
 * AgentStatusModal - Modal for viewing running and completed subagents
 *
 * Shows:
 * - Running agents with task, iterations, and Cancel button
 * - Completed agents with final status
 * - View Branch links to navigate to agent conversations
 * - Continue button for paused (max_iterations) agents
 *
 * Uses Obsidian's Modal and Setting components for consistent UI.
 */

import { App, Modal, Setting } from 'obsidian';
import type { SubagentExecutor } from '../../../services/chat/SubagentExecutor';
import type { AgentStatusItem, BranchState } from '../../../types/branch/BranchTypes';

export interface AgentStatusModalCallbacks {
  onViewBranch: (branchId: string) => void;
  onContinueAgent: (branchId: string) => void;
}

export class AgentStatusModal extends Modal {
  private subagentExecutor: SubagentExecutor;
  private callbacks: AgentStatusModalCallbacks;

  constructor(
    app: App,
    subagentExecutor: SubagentExecutor,
    callbacks: AgentStatusModalCallbacks
  ) {
    super(app);
    this.subagentExecutor = subagentExecutor;
    this.callbacks = callbacks;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass('nexus-agent-status-modal');

    this.titleEl.setText('Running Agents');

    this.renderContent();
  }

  private renderContent(): void {
    const { contentEl } = this;
    contentEl.empty();

    const agents = this.subagentExecutor.getAgentStatusList();
    const running = agents.filter(a => a.state === 'running');
    const completed = agents.filter(a => a.state !== 'running');

    // Running section
    if (running.length === 0 && completed.length === 0) {
      contentEl.createEl('p', {
        text: 'No agents have been spawned yet',
        cls: 'nexus-agent-empty',
      });
    } else if (running.length === 0) {
      contentEl.createEl('p', {
        text: 'No agents currently running',
        cls: 'nexus-agent-empty',
      });
    } else {
      for (const agent of running) {
        this.renderAgentRow(contentEl, agent);
      }
    }

    // Completed section
    if (completed.length > 0) {
      contentEl.createEl('h4', { text: 'Completed', cls: 'nexus-agent-section-header' });
      for (const agent of completed) {
        this.renderAgentRow(contentEl, agent);
      }
    }

    // Close button at bottom
    new Setting(contentEl).addButton(btn =>
      btn.setButtonText('Close').onClick(() => this.close())
    );
  }

  private renderAgentRow(container: HTMLElement, agent: AgentStatusItem): void {
    const isRunning = agent.state === 'running';
    const isPaused = agent.state === 'max_iterations';

    const setting = new Setting(container)
      .setName(`${agent.task} ${this.getStatusIcon(agent.state)}`)
      .setDesc(this.buildDescription(agent))
      .addButton(btn =>
        btn.setButtonText('View').onClick(() => {
          this.close();
          this.callbacks.onViewBranch(agent.branchId);
        })
      );

    if (isRunning) {
      setting.addButton(btn =>
        btn
          .setButtonText('Cancel')
          .setWarning()
          .onClick(() => {
            this.subagentExecutor.cancelSubagent(agent.subagentId);
            this.renderContent(); // Refresh modal
          })
      );
    }

    if (isPaused) {
      setting.addButton(btn =>
        btn
          .setButtonText('Continue')
          .setCta()
          .onClick(() => {
            this.close();
            this.callbacks.onContinueAgent(agent.branchId);
          })
      );
    }

    // Add CSS class based on state
    setting.settingEl.addClass(`nexus-agent-row-${agent.state}`);
  }

  private getStatusIcon(state: BranchState): string {
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

  private buildDescription(agent: AgentStatusItem): string {
    const timeAgo = this.formatTimeAgo(agent.startedAt);

    switch (agent.state) {
      case 'running':
        return `${agent.iterations}/${agent.maxIterations} iterations · Started ${timeAgo}`;
      case 'complete':
        return `Completed in ${agent.iterations} iterations · ${timeAgo}`;
      case 'cancelled':
        return `Cancelled after ${agent.iterations} iterations · ${timeAgo}`;
      case 'max_iterations':
        return `Paused at max iterations (${agent.iterations}/${agent.maxIterations}) · ${timeAgo}`;
      case 'abandoned':
        return `Abandoned after ${agent.iterations} iterations · ${timeAgo}`;
      default:
        return `${agent.iterations} iterations · ${timeAgo}`;
    }
  }

  private formatTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
