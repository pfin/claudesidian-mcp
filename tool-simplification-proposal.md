# Tool Simplification Proposal

## Overview

This document outlines a comprehensive simplification of the Nexus tool architecture, reducing tool count, improving safety, and establishing consistent naming conventions aligned with CLI patterns and CRUA (Create, Read, Update, Archive) principles.

---

## Problem Statement

### Current Issues

1. **Too many tools (43 total)** - cognitive overhead for LLMs and users
2. **Destructive actions are permanent** - no recovery path for deletes
3. **Redundant tools** - multiple tools doing similar things (3 replace variants, 2 move tools)
4. **Inconsistent parameter naming** - `filePath` vs `path`, `offset/limit` vs `startLine/endLine`
5. **Confusing naming** - `deleteContent` (removes text) vs `deleteNote` (removes file)

### Current Tool Count by Agent

| Agent | Tools | Destructive |
|-------|-------|-------------|
| ContentManager | 8 | 4 |
| VaultManager | 9 | 2 |
| VaultLibrarian | 3 | 0 |
| MemoryManager | 12 | 0 |
| AgentManager | 9 | 1 |
| CommandManager | 2 (hidden) | 0 |
| ToolManager | 2 | 0 |
| **Total** | **43** | **7** |

---

## Design Principles

### CRUA Pattern (replaces CRUD)

| Operation | Description | Safety |
|-----------|-------------|--------|
| **C**reate | Create new files/folders | Safe |
| **R**ead | Read content, list items | Safe |
| **U**pdate | Modify existing content | Reversible |
| **A**rchive | Move to `.archive/` instead of delete | Recoverable |

### CLI Alignment

Tool names follow familiar CLI conventions:
- `ls`, `mkdir`, `mv`, `cp` for file operations
- `read`, `write`, `update` for content operations
- `archive` instead of `rm` (safe delete)

### Archive Pattern

All "delete" operations become archive operations:
- Items move to `.archive/[YYYY-MM-DD_HH-mm-ss]/[original-path]`
- Preserves full path structure for easy recovery
- Timestamp prevents conflicts
- User can manually clean `.archive/` periodically

---

## Parameter Ontology

Consistent parameter naming across all tools:

### Path Parameters

| Parameter | Type | Description | Used By |
|-----------|------|-------------|---------|
| `path` | string | Source file or folder path | All tools |
| `newPath` | string | Destination path | `mv`, `cp` |

### Content Parameters

| Parameter | Type | Description | Used By |
|-----------|------|-------------|---------|
| `content` | string | Content to write/insert | `write`, `update` |

### Line Parameters

| Parameter | Type | Description | Used By |
|-----------|------|-------------|---------|
| `startLine` | number | Start line, 1-based. Use -1 for end of file | `read`, `update` |
| `endLine` | number | End line, 1-based, inclusive | `read`, `update` |

### Flag Parameters

| Parameter | Type | Description | Used By |
|-----------|------|-------------|---------|
| `overwrite` | boolean | Overwrite if exists | `write`, `mv`, `cp` |

---

## ContentManager Simplification

### Before (8 tools)

| Tool | Purpose |
|------|---------|
| `readContent` | Read file content |
| `createContent` | Create a file |
| `appendContent` | Append to file |
| `prependContent` | Prepend to file |
| `replaceContent` | Fuzzy match replace |
| `replaceByLine` | Line-based replace |
| `findReplaceContent` | Find and replace |
| `deleteContent` | Delete content from file |

### After (3 tools)

| Tool | Purpose | CRUA |
|------|---------|------|
| `read` | Read file content | R |
| `write` | Create or overwrite file | C |
| `update` | Insert, replace, or delete lines | U |

### Tool Specifications

#### `read`

Read content from a file with optional line range.

```typescript
read({
  path: string,        // Path to file
  startLine?: number,  // Start line (1-based), default: 1
  endLine?: number     // End line (1-based, inclusive), default: end of file
})
```

**Examples:**
```typescript
// Read entire file
read({ path: "notes/todo.md" })

// Read lines 10-20
read({ path: "notes/todo.md", startLine: 10, endLine: 20 })

// Read from line 50 to end
read({ path: "notes/todo.md", startLine: 50 })
```

#### `write`

Create a new file or overwrite existing file.

```typescript
write({
  path: string,        // Path to file
  content: string,     // Content to write
  overwrite?: boolean  // Overwrite if exists, default: false
})
```

**Examples:**
```typescript
// Create new file
write({ path: "notes/new-note.md", content: "# New Note\n\nContent here." })

// Overwrite existing file
write({ path: "notes/existing.md", content: "# Replaced", overwrite: true })
```

#### `update`

Insert, replace, or delete content at specific line positions.

```typescript
update({
  path: string,        // Path to file
  content: string,     // Content to insert/replace (empty string = delete)
  startLine: number,   // Start line (1-based), use -1 for end of file
  endLine?: number     // End line (optional - omit to insert, provide to replace)
})
```

**Behavior:**
- `startLine` only → **INSERT** at that line (pushes existing content down)
- `startLine` + `endLine` → **REPLACE** that range
- `content: ""` with range → **DELETE** that range
- `startLine: -1` → **APPEND** to end of file

**Examples:**
```typescript
// INSERT at line 5 (pushes existing line 5+ down)
update({ path: "note.md", content: "inserted text\n", startLine: 5 })

// APPEND to end of file
update({ path: "note.md", content: "\n## New Section", startLine: -1 })

// PREPEND to start of file
update({ path: "note.md", content: "# Title\n\n", startLine: 1 })

// REPLACE lines 5-10 with new content
update({ path: "note.md", content: "replacement text", startLine: 5, endLine: 10 })

// DELETE lines 5-10
update({ path: "note.md", content: "", startLine: 5, endLine: 10 })
```

---

## VaultManager Simplification

### Before (9 tools)

| Tool | Purpose |
|------|---------|
| `listDirectory` | List files and folders |
| `createFolder` | Create folder |
| `editFolder` | Edit folder properties |
| `moveFolder` | Move folder |
| `deleteFolder` | Delete folder (permanent) |
| `deleteNote` | Delete note (permanent) |
| `moveNote` | Move note |
| `duplicateNote` | Duplicate note |
| `openNote` | Open note in editor |

### After (6 tools)

| Tool | Purpose | CRUA |
|------|---------|------|
| `ls` | List directory contents | R |
| `mkdir` | Create folder | C |
| `mv` | Move or rename file/folder | U |
| `cp` | Duplicate file | C |
| `archive` | Move to `.archive/` with timestamp | A |
| `open` | Open file in editor | R |

### Tool Specifications

#### `ls`

List contents of a directory.

```typescript
ls({
  path?: string,      // Path to directory, default: vault root
  filter?: string     // Optional filter pattern
})
```

**Examples:**
```typescript
// List vault root
ls({})

// List specific folder
ls({ path: "projects" })

// List with filter
ls({ path: "notes", filter: "*.md" })
```

#### `mkdir`

Create a new folder.

```typescript
mkdir({
  path: string        // Path for new folder
})
```

**Examples:**
```typescript
mkdir({ path: "projects/new-project" })
```

#### `mv`

Move or rename a file or folder.

```typescript
mv({
  path: string,        // Source path (file or folder)
  newPath: string,     // Destination path
  overwrite?: boolean  // Overwrite if exists, default: false
})
```

**Examples:**
```typescript
// Move a note
mv({ path: "inbox/note.md", newPath: "projects/note.md" })

// Rename a note
mv({ path: "note.md", newPath: "renamed-note.md" })

// Move a folder
mv({ path: "old-folder", newPath: "archive/old-folder" })

// Move with overwrite
mv({ path: "draft.md", newPath: "final.md", overwrite: true })
```

#### `cp`

Duplicate a file.

```typescript
cp({
  path: string,        // Source file path
  newPath: string,     // Destination path
  overwrite?: boolean  // Overwrite if exists, default: false
})
```

**Examples:**
```typescript
// Duplicate a note
cp({ path: "templates/meeting.md", newPath: "meetings/2024-01-15.md" })
```

#### `archive`

Safely archive a file or folder (moves to `.archive/` with timestamp).

```typescript
archive({
  path: string         // Path to file or folder to archive
})
```

**Behavior:**
- Moves item to `.archive/[YYYY-MM-DD_HH-mm-ss]/[original-path]`
- Preserves full directory structure
- Auto-detects file vs folder
- Creates `.archive/` if it doesn't exist

**Examples:**
```typescript
// Archive a note
archive({ path: "old-notes/deprecated.md" })
// Result: .archive/2025-12-27_14-30-45/old-notes/deprecated.md

// Archive a folder
archive({ path: "projects/cancelled-project" })
// Result: .archive/2025-12-27_14-30-45/projects/cancelled-project/
```

#### `open`

Open a file in the editor.

```typescript
open({
  path: string         // Path to file to open
})
```

**Examples:**
```typescript
open({ path: "notes/todo.md" })
```

---

## AgentManager Consideration

### Current Delete Tool

`deleteAgent` permanently removes custom agents.

### Recommendation

Replace with `archiveAgent` that:
- Marks agent as inactive (`isEnabled: false`)
- Moves agent config to `.archive/agents/[timestamp]/[agent-name].json`
- Agent can be restored by moving back or re-creating

---

## Summary of Changes

### Tool Count Reduction

| Agent | Before | After | Reduction |
|-------|--------|-------|-----------|
| ContentManager | 8 | 3 | -62% |
| VaultManager | 9 | 6 | -33% |
| **Subtotal** | **17** | **9** | **-47%** |

### Tools Removed

**ContentManager (5 removed):**
- `appendContent` → use `update` with `startLine: -1`
- `prependContent` → use `update` with `startLine: 1`
- `replaceContent` → use `update` with `startLine`/`endLine`
- `replaceByLine` → renamed/refactored to `update`
- `findReplaceContent` → use `update` (LLM reads file first, determines lines)
- `deleteContent` → use `update` with `content: ""`

**VaultManager (3 removed):**
- `deleteNote` → replaced by `archive`
- `deleteFolder` → replaced by `archive`
- `moveNote` → consolidated into `mv`
- `moveFolder` → consolidated into `mv`
- `editFolder` → use `mv` for rename

### Safety Improvements

| Before | After | Benefit |
|--------|-------|---------|
| Permanent delete | Archive with timestamp | Full recovery possible |
| Multiple replace tools | Single `update` tool | Less confusion |
| Inconsistent params | Unified ontology | Predictable API |

---

## Migration Path

### Phase 1: Implement New Tools
1. Create `archive` tool with timestamp logic
2. Create unified `mv` tool (auto-detect file/folder)
3. Refactor `replaceByLine` into `update` with insert capability
4. Rename tools to CLI-style names

### Phase 2: Update Exports
1. Update agent tool registrations
2. Update tool index exports
3. Update types

### Phase 3: Remove Deprecated Tools
1. Remove old tool files
2. Clean up unused types
3. Update documentation

### Phase 4: Testing
1. Test all CRUA operations
2. Test archive/recovery workflow
3. Test edge cases (empty files, large files, special characters)

---

## Open Questions

1. **Archive cleanup**: Should there be an `emptyArchive` tool or leave to user?
2. **Archive restore**: Should there be a `restore` tool or just use `mv`?
3. **Line number edge cases**: How to handle `startLine` beyond file length?
4. **Binary files**: Should `archive` handle attachments/images?
5. **Agent archiving**: Implement `archiveAgent` in this phase or later?

---

## Appendix: Full Tool Reference

### ContentManager (3 tools)

```typescript
// Read
read({ path, startLine?, endLine? })

// Create
write({ path, content, overwrite? })

// Update (insert/replace/delete)
update({ path, content, startLine, endLine? })
```

### VaultManager (6 tools)

```typescript
// Read
ls({ path?, filter? })
open({ path })

// Create
mkdir({ path })
cp({ path, newPath, overwrite? })

// Update
mv({ path, newPath, overwrite? })

// Archive
archive({ path })
```

### Unchanged Agents

- **VaultLibrarian**: `searchContent`, `searchDirectory`, `searchMemory` (no changes needed)
- **MemoryManager**: Session/State/Workspace tools (no changes needed)
- **AgentManager**: Consider `archiveAgent` in future phase
- **ToolManager**: `getTools`, `useTools` (no changes needed)
