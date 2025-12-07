/**
 * WorkspaceSectionRenderer - Renders workspace selection section
 *
 * Simple dropdown for workspace selection.
 */

import { Setting } from 'obsidian';
import { ISectionRenderer, ChatSettingsState, ChatSettingsDependencies } from './types';

export class WorkspaceSectionRenderer implements ISectionRenderer {
  private workspaceDropdown: HTMLSelectElement | null = null;

  constructor(
    private state: ChatSettingsState,
    private deps: ChatSettingsDependencies
  ) {}

  render(container: HTMLElement): void {
    new Setting(container)
      .setName('Workspace')
      .setDesc('Include workspace context in the system prompt')
      .addDropdown(dropdown => {
        this.workspaceDropdown = dropdown.selectEl;

        dropdown.addOption('', 'None');

        this.state.availableWorkspaces.forEach(workspace => {
          dropdown.addOption(workspace.id, workspace.name);
        });

        dropdown.setValue(this.state.selectedWorkspaceId || '');

        dropdown.onChange(async (value) => {
          this.state.selectedWorkspaceId = value || null;
          await this.deps.onWorkspaceChange?.(value || null);
        });
      });
  }

  update(): void {
    if (this.workspaceDropdown) {
      this.workspaceDropdown.value = this.state.selectedWorkspaceId || '';
    }
  }

  destroy(): void {
    this.workspaceDropdown = null;
  }
}
