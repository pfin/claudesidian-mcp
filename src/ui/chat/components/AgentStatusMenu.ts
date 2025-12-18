/**
 * AgentStatusMenu - Header icon + badge showing running subagent count
 *
 * Displays in the chat header next to settings button.
 * Shows:
 * - Robot icon with badge when agents are running
 * - Clicking opens AgentStatusModal
 *
 * Uses Obsidian's setIcon helper for consistent iconography.
 * Uses event-based updates instead of polling for efficiency.
 */

import { setIcon, Component, Events } from 'obsidian';
import type { SubagentExecutor } from '../../../services/chat/SubagentExecutor';
import type { SubagentExecutorEvents } from '../../../types/branch/BranchTypes';

export interface AgentStatusMenuCallbacks {
  onOpenModal: () => void;
}

/**
 * Event emitter for subagent status updates
 * Allows UI components to subscribe to status changes without polling
 */
export class SubagentEventBus extends Events {
  trigger(name: 'status-changed'): void {
    super.trigger(name);
  }

  on(name: 'status-changed', callback: () => void): ReturnType<Events['on']> {
    return super.on(name, callback);
  }
}

// Singleton event bus for subagent status updates
let globalEventBus: SubagentEventBus | null = null;

export function getSubagentEventBus(): SubagentEventBus {
  if (!globalEventBus) {
    globalEventBus = new SubagentEventBus();
  }
  return globalEventBus;
}

/**
 * Create event handlers that notify the event bus
 * Wire these to SubagentExecutor.setEventHandlers()
 */
export function createSubagentEventHandlers(): Partial<SubagentExecutorEvents> {
  const eventBus = getSubagentEventBus();

  return {
    onSubagentStarted: () => {
      eventBus.trigger('status-changed');
    },
    onSubagentComplete: () => {
      eventBus.trigger('status-changed');
    },
    onSubagentError: () => {
      eventBus.trigger('status-changed');
    },
  };
}

export class AgentStatusMenu {
  private element: HTMLElement | null = null;
  private badgeEl: HTMLElement | null = null;
  private lastCount: number = 0;
  private eventRef: ReturnType<Events['on']> | null = null;

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

    // Subscribe to event bus for status updates (replaces polling)
    this.subscribeToEvents();

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
   * Subscribe to subagent status events
   */
  private subscribeToEvents(): void {
    const eventBus = getSubagentEventBus();
    this.eventRef = eventBus.on('status-changed', () => {
      this.updateDisplay();
    });
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
    // Unsubscribe from events
    if (this.eventRef) {
      getSubagentEventBus().offref(this.eventRef);
      this.eventRef = null;
    }

    this.element?.remove();
    this.element = null;
    this.badgeEl = null;
  }
}
