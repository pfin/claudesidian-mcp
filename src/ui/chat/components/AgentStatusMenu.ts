/**
 * AgentStatusMenu - Header icon + badge showing running subagent count
 *
 * Displays in the chat header next to settings button.
 * Shows:
 * - Robot icon with badge when agents are running
 * - Clicking opens AgentStatusModal
 *
 * Uses Obsidian's setIcon helper for consistent iconography.
 */

import { setIcon, Component } from 'obsidian';
import type { SubagentExecutor } from '../../../services/chat/SubagentExecutor';

export interface AgentStatusMenuCallbacks {
  onOpenModal: () => void;
}

export class AgentStatusMenu {
  private element: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private updateInterval: number | null = null;
  private lastCount: number = 0;

  constructor(
    private container: HTMLElement,
    private subagentExecutor: SubagentExecutor | null,
    private callbacks: AgentStatusMenuCallbacks,
    private component?: Component
  ) {}

  /**
   * Create and render the status menu button
   */
  render(): HTMLElement {
    // Create the button element
    const button = document.createElement('button');
    button.addClass('clickable-icon', 'nexus-agent-status-button');
    button.setAttribute('aria-label', 'Running agents');
    button.setAttribute('title', 'Running agents');

    // Icon container
    const iconContainer = button.createDiv('nexus-agent-status-icon');
    setIcon(iconContainer, 'bot');

    // Badge (hidden by default)
    const badge = button.createDiv('nexus-agent-status-badge');
    badge.addClass('nexus-badge-hidden');
    badge.textContent = '0';
    this.badgeEl = badge;

    // Click handler
    if (this.component) {
      this.component.registerDomEvent(button, 'click', () => {
        this.callbacks.onOpenModal();
      });
    } else {
      button.addEventListener('click', () => {
        this.callbacks.onOpenModal();
      });
    }

    this.element = button;
    this.container.appendChild(button);

    // Start polling for updates
    this.startPolling();

    // Initial update
    this.updateDisplay();

    return button;
  }

  /**
   * Update the executor reference (if initialized later)
   */
  setSubagentExecutor(executor: SubagentExecutor): void {
    this.subagentExecutor = executor;
    this.updateDisplay();
  }

  /**
   * Update the badge display based on running agent count
   */
  updateDisplay(): void {
    if (!this.element || !this.badgeEl) return;

    const runningCount = this.getRunningCount();

    // Only update DOM if count changed
    if (runningCount === this.lastCount) return;
    this.lastCount = runningCount;

    if (runningCount > 0) {
      this.badgeEl.textContent = runningCount.toString();
      this.badgeEl.removeClass('nexus-badge-hidden');
      this.element.addClass('nexus-agents-active');
      this.element.setAttribute('title', `${runningCount} agent${runningCount > 1 ? 's' : ''} running`);
    } else {
      this.badgeEl.addClass('nexus-badge-hidden');
      this.element.removeClass('nexus-agents-active');
      this.element.setAttribute('title', 'Running agents');
    }
  }

  /**
   * Get count of running agents
   */
  private getRunningCount(): number {
    if (!this.subagentExecutor) return 0;

    try {
      const statusList = this.subagentExecutor.getAgentStatusList();
      return statusList.filter(a => a.state === 'running').length;
    } catch {
      return 0;
    }
  }

  /**
   * Start polling for agent status updates
   * Poll every 2 seconds to keep badge updated
   */
  private startPolling(): void {
    if (this.updateInterval !== null) return;

    this.updateInterval = window.setInterval(() => {
      this.updateDisplay();
    }, 2000);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.updateInterval !== null) {
      window.clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Force refresh the display (call after agent state changes)
   */
  refresh(): void {
    this.lastCount = -1; // Force update
    this.updateDisplay();
  }

  /**
   * Show visual feedback when an agent completes
   */
  showCompletionPulse(): void {
    if (!this.element) return;

    this.element.addClass('nexus-agent-completion-pulse');
    setTimeout(() => {
      this.element?.removeClass('nexus-agent-completion-pulse');
    }, 1000);
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.stopPolling();
    this.element?.remove();
    this.element = null;
    this.badgeEl = null;
  }
}
