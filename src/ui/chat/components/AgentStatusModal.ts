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
 * Uses shared utilities for status display and time formatting (DRY).
 */

import { App, Modal, Setting } from 'obsidian';
import type { SubagentExecutor } from '../../../services/chat/SubagentExecutor';
import type { AgentStatusItem, BranchState } from '../../../types/branch/BranchTypes';
import { formatTimeAgo } from '../../../utils/timeUtils';
import { getStateIconName, buildStatusDescription } from '../../../utils/branchStatusUtils';

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
    const iconName = getStateIconName(agent.state);

    const setting = new Setting(container)
      .setName(agent.task)
      .setDesc(this.buildDescription(agent))
      .addButton(btn =>
        btn.setButtonText('View').onClick(() => {
          this.close();
          this.callbacks.onViewBranch(agent.branchId);
        })
      );

    // Add status icon to the name
    const nameEl = setting.nameEl;
    const iconEl = nameEl.createSpan('nexus-agent-status-icon');
    iconEl.addClass(`nexus-state-icon-${agent.state}`);
    // Use Obsidian setIcon
    import('obsidian').then(({ setIcon }) => {
      setIcon(iconEl, iconName);
    });

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

  /**
   * Build description using shared utilities
   */
  private buildDescription(agent: AgentStatusItem): string {
    const timeAgo = formatTimeAgo(agent.startedAt);

    // Convert AgentStatusItem to SubagentBranchMetadata-compatible object
    const metadataLike = {
      state: agent.state,
      iterations: agent.iterations,
      maxIterations: agent.maxIterations,
      task: agent.task,
      subagentId: agent.subagentId,
      startedAt: agent.startedAt,
    };

    return buildStatusDescription(metadataLike, timeAgo);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
