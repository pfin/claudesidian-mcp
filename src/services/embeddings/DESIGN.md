# SQLite-vec Embeddings Integration Design

## Executive Summary

This document outlines a strategy for integrating vector embeddings into Nexus using:
- **Transformers.js** for local, WASM-based embedding generation
- **SQLite with vector storage** for persistent embedding storage
- **Note-level embeddings** (one embedding per note, no chunking)

---

## 1. Research Findings

### 1.1 SQLite-vec Extension

[sqlite-vec](https://github.com/asg017/sqlite-vec) is a vector search SQLite extension that:
- Runs anywhere SQLite runs (including WASM in browsers)
- Uses `vec0` virtual tables for vector storage
- Supports float, int8, and binary vector types
- Provides KNN (k-nearest neighbor) queries with cosine distance

**Example Usage:**
```sql
-- Create vector table
CREATE VIRTUAL TABLE note_embeddings USING vec0(
  note_embedding float[384]
);

-- Insert embedding
INSERT INTO note_embeddings(rowid, note_embedding)
VALUES (1, '[-0.200, 0.250, 0.341, ...]');

-- KNN query
SELECT rowid, distance
FROM note_embeddings
WHERE note_embedding MATCH '[0.890, 0.544, ...]'
ORDER BY distance
LIMIT 10;
```

### 1.2 Compatibility Challenge

**Current Nexus SQLite Setup:**
- Uses `sql.js` v1.13.0 (pure JavaScript SQLite compiled to asm.js)
- Located at: `src/database/storage/SQLiteCacheManager.ts`
- Uses asm.js version (not WASM) to avoid CDN dependencies

**The Challenge:**
sqlite-vec is a native SQLite extension. Loading it into sql.js requires:
1. A custom sql.js build with sqlite-vec compiled in, OR
2. Loading the extension dynamically (may not be supported in all sql.js versions)

### 1.3 Transformers.js for Embeddings

[Transformers.js](https://huggingface.co/docs/transformers.js) provides browser-based ML inference:

**Recommended Model:** `Xenova/all-MiniLM-L6-v2`
- **Dimensions:** 384 (compact, efficient)
- **Size:** ~23MB quantized (q8)
- **Performance:** Fast inference, good semantic quality
- **Backend:** WASM (q8 default) or WebGPU (fp16/fp32)

**Usage Example:**
```typescript
import { pipeline } from '@huggingface/transformers';

const extractor = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2'
);

const output = await extractor(
  'Your note content here',
  { pooling: 'mean', normalize: true }
);
// Returns: Tensor { dims: [1, 384], data: Float32Array }
```

---

## 2. Proposed Architecture

### 2.1 Option A: Pure JavaScript Vector Similarity (Recommended)

Since sqlite-vec integration with sql.js is complex, we can:
1. **Store embeddings as JSON blobs in SQLite**
2. **Compute similarity in JavaScript**
3. **Use efficient data structures for fast lookups**

**Advantages:**
- Works with existing sql.js setup
- No native extension dependencies
- Full control over similarity algorithms
- Easier to debug and maintain

**Schema Extension:**
```sql
-- Add to existing schema.ts
CREATE TABLE IF NOT EXISTS note_embeddings (
  id TEXT PRIMARY KEY,
  notePath TEXT NOT NULL UNIQUE,
  embedding BLOB NOT NULL,        -- Float32Array as binary
  model TEXT NOT NULL,            -- e.g., 'all-MiniLM-L6-v2'
  contentHash TEXT NOT NULL,      -- To detect content changes
  dimensions INTEGER NOT NULL,    -- e.g., 384
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_path ON note_embeddings(notePath);
CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON note_embeddings(contentHash);
```

### 2.2 Option B: sqlite-vec with Custom sql.js Build

For maximum performance with large note collections:
1. Build custom sql.js with sqlite-vec compiled in
2. Use native vector similarity operations

**This requires:**
- Custom Emscripten build process
- Maintaining a forked sql.js build
- More complex deployment

---

## 3. Recommended Implementation (Option A)

### 3.1 New Service: EmbeddingService

```typescript
// src/services/embeddings/EmbeddingService.ts

import { pipeline, Pipeline } from '@huggingface/transformers';

interface NoteEmbedding {
  id: string;
  notePath: string;
  embedding: Float32Array;
  model: string;
  contentHash: string;
  dimensions: number;
  created: number;
  updated: number;
}

interface SimilarNote {
  notePath: string;
  similarity: number;
  distance: number;
}

export class EmbeddingService {
  private extractor: Pipeline | null = null;
  private readonly MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
  private readonly DIMENSIONS = 384;
  private isLoading = false;

  constructor(
    private sqliteManager: SQLiteCacheManager,
    private app: App
  ) {}

  /**
   * Initialize the embedding model (lazy load)
   */
  async initialize(): Promise<void> {
    if (this.extractor || this.isLoading) return;

    this.isLoading = true;
    try {
      this.extractor = await pipeline(
        'feature-extraction',
        this.MODEL_ID,
        {
          quantized: true,  // Use q8 for smaller size
          progress_callback: (progress) => {
            // Emit progress for UI
            this.onProgress?.(progress);
          }
        }
      );
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Generate embedding for text content
   */
  async generateEmbedding(text: string): Promise<Float32Array> {
    await this.initialize();
    if (!this.extractor) {
      throw new Error('Embedding model not initialized');
    }

    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true
    });

    return new Float32Array(output.data);
  }

  /**
   * Embed a note and store in database
   */
  async embedNote(notePath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(notePath);
    if (!file || !(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const contentHash = this.hashContent(content);

    // Check if embedding exists and is current
    const existing = await this.getEmbedding(notePath);
    if (existing && existing.contentHash === contentHash) {
      return; // Already up to date
    }

    // Generate new embedding
    const embedding = await this.generateEmbedding(content);

    // Store in database
    await this.storeEmbedding({
      id: this.generateId(),
      notePath,
      embedding,
      model: this.MODEL_ID,
      contentHash,
      dimensions: this.DIMENSIONS,
      created: existing?.created || Date.now(),
      updated: Date.now()
    });
  }

  /**
   * Find similar notes using cosine similarity
   */
  async findSimilarNotes(
    notePath: string,
    limit: number = 10
  ): Promise<SimilarNote[]> {
    const sourceEmbedding = await this.getEmbedding(notePath);
    if (!sourceEmbedding) return [];

    // Load all embeddings (optimize with indexing for large vaults)
    const allEmbeddings = await this.getAllEmbeddings();

    const similarities: SimilarNote[] = [];

    for (const note of allEmbeddings) {
      if (note.notePath === notePath) continue;

      const similarity = this.cosineSimilarity(
        sourceEmbedding.embedding,
        note.embedding
      );

      similarities.push({
        notePath: note.notePath,
        similarity,
        distance: 1 - similarity
      });
    }

    // Sort by similarity (descending) and take top N
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Semantic search across all notes
   */
  async semanticSearch(
    query: string,
    limit: number = 10
  ): Promise<SimilarNote[]> {
    const queryEmbedding = await this.generateEmbedding(query);
    const allEmbeddings = await this.getAllEmbeddings();

    const results: SimilarNote[] = allEmbeddings.map(note => ({
      notePath: note.notePath,
      similarity: this.cosineSimilarity(queryEmbedding, note.embedding),
      distance: 0
    }));

    results.forEach(r => r.distance = 1 - r.similarity);

    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  /**
   * Cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ... storage methods using SQLiteCacheManager
}
```

### 3.2 Note Change Monitoring

Hook into Obsidian's vault events to update embeddings:

```typescript
// src/services/embeddings/EmbeddingWatcher.ts

export class EmbeddingWatcher {
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_MS = 2000; // Wait 2s after last edit

  constructor(
    private embeddingService: EmbeddingService,
    private app: App
  ) {}

  start(): void {
    // Monitor file changes
    this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && this.isNote(file)) {
        this.scheduleReembedding(file.path);
      }
    });

    this.app.vault.on('create', (file) => {
      if (file instanceof TFile && this.isNote(file)) {
        this.scheduleReembedding(file.path);
      }
    });

    this.app.vault.on('delete', (file) => {
      if (file instanceof TFile && this.isNote(file)) {
        this.removeEmbedding(file.path);
      }
    });

    this.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && this.isNote(file)) {
        this.updateEmbeddingPath(oldPath, file.path);
      }
    });
  }

  private scheduleReembedding(notePath: string): void {
    // Cancel existing timer
    const existing = this.debounceTimers.get(notePath);
    if (existing) clearTimeout(existing);

    // Schedule new embedding
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(notePath);
      try {
        await this.embeddingService.embedNote(notePath);
      } catch (error) {
        console.error(`Failed to embed ${notePath}:`, error);
      }
    }, this.DEBOUNCE_MS);

    this.debounceTimers.set(notePath, timer);
  }

  private isNote(file: TFile): boolean {
    return file.extension === 'md';
  }
}
```

### 3.3 Background Processing Queue

For initial vault indexing:

```typescript
// src/services/embeddings/EmbeddingQueue.ts

export class EmbeddingQueue {
  private queue: string[] = [];
  private processing = false;
  private readonly BATCH_SIZE = 5;
  private readonly DELAY_BETWEEN_BATCHES_MS = 100;

  constructor(private embeddingService: EmbeddingService) {}

  /**
   * Add notes to embedding queue
   */
  enqueue(notePaths: string[]): void {
    this.queue.push(...notePaths);
    this.processQueue();
  }

  /**
   * Process queue in batches
   */
  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.BATCH_SIZE);

        await Promise.all(
          batch.map(path =>
            this.embeddingService.embedNote(path)
              .catch(err => console.error(`Failed to embed ${path}:`, err))
          )
        );

        // Yield to UI
        await this.delay(this.DELAY_BETWEEN_BATCHES_MS);

        // Emit progress
        this.onProgress?.({
          processed: this.totalProcessed,
          remaining: this.queue.length,
          total: this.totalProcessed + this.queue.length
        });
      }
    } finally {
      this.processing = false;
    }
  }
}
```

---

## 4. Schema Changes

Add to `src/database/schema/schema.ts`:

```sql
-- ==================== NOTE EMBEDDINGS ====================

CREATE TABLE IF NOT EXISTS note_embeddings (
  id TEXT PRIMARY KEY,
  notePath TEXT NOT NULL UNIQUE,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  contentHash TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_path ON note_embeddings(notePath);
CREATE INDEX IF NOT EXISTS idx_embeddings_hash ON note_embeddings(contentHash);
CREATE INDEX IF NOT EXISTS idx_embeddings_model ON note_embeddings(model);
```

---

## 5. Performance Considerations

### 5.1 Memory Usage

- **Model Size:** ~23MB for quantized all-MiniLM-L6-v2
- **Per-note embedding:** 384 floats * 4 bytes = 1.5KB per note
- **1000 notes:** ~1.5MB of embedding storage
- **10,000 notes:** ~15MB of embedding storage

### 5.2 Computation

- **Initial embedding:** ~50-100ms per note on modern hardware
- **Similarity search:** O(n) for brute force, can be optimized with:
  - Inverted index
  - Approximate nearest neighbors (HNSW, LSH)
  - Clustering for pre-filtering

### 5.3 Optimization Strategies

For large vaults (>5000 notes):

```typescript
// Use Web Workers for embedding generation
const worker = new Worker('embedding-worker.js');

// Implement approximate nearest neighbor
class ApproximateNNIndex {
  // Use product quantization or HNSW-like structures
}

// Cache frequently accessed similarities
class SimilarityCache {
  // LRU cache for note pair similarities
}
```

---

## 6. Integration Points

### 6.1 Existing ContentCache

The `ContentCache` class already has embedding support:
- `cacheEmbedding()` - Store in memory
- `getCachedEmbedding()` - Retrieve from memory

Extend to use persistent SQLite storage.

### 6.2 Search Enhancement

Combine with existing FTS4:
```typescript
async hybridSearch(query: string): Promise<SearchResult[]> {
  const [ftsResults, semanticResults] = await Promise.all([
    this.sqliteManager.searchMessages(query),
    this.embeddingService.semanticSearch(query)
  ]);

  // Combine and rank results
  return this.rankResults(ftsResults, semanticResults);
}
```

### 6.3 Context Selection

Use embeddings for smarter context selection:
```typescript
async selectRelevantContext(
  userMessage: string,
  allNotes: string[],
  maxTokens: number
): Promise<string[]> {
  // Find semantically similar notes
  const similar = await this.embeddingService.semanticSearch(
    userMessage,
    20
  );

  // Select top notes within token budget
  return this.selectWithinBudget(similar, maxTokens);
}
```

---

## 7. Dependencies to Add

```json
{
  "dependencies": {
    "@huggingface/transformers": "^3.0.0"
  }
}
```

---

## 8. Future Enhancements

### 8.1 sqlite-vec Native Integration

When/if sql.js adds extension loading support:
```typescript
// Future: native sqlite-vec support
await db.loadExtension('sqlite-vec');
await db.exec(`
  CREATE VIRTUAL TABLE note_vec USING vec0(
    embedding float[384]
  );
`);
```

### 8.2 WebGPU Acceleration

For WebGPU-capable browsers:
```typescript
const extractor = await pipeline(
  'feature-extraction',
  'Xenova/all-MiniLM-L6-v2',
  { device: 'webgpu' }  // 10-60x faster than WASM
);
```

### 8.3 Alternative Models

| Model | Dimensions | Size | Use Case |
|-------|-----------|------|----------|
| all-MiniLM-L6-v2 | 384 | 23MB | General purpose |
| bge-small-en-v1.5 | 384 | 33MB | Higher quality |
| gte-small | 384 | 30MB | Good multilingual |
| nomic-embed-text-v1.5 | 768 | 137MB | Best quality |

---

## 9. Obsidian/Electron-Specific Considerations

Based on patterns established in your WebLLM implementation, here are critical considerations for running Transformers.js in Obsidian's Electron environment:

### 9.1 Module Loading Strategy

**Challenge:** Obsidian's sandboxed Electron environment has restrictions on bundling large WASM-based libraries.

**Solution:** Load Transformers.js from CDN at runtime (following WebLLM pattern):

```typescript
// src/services/embeddings/EmbeddingEngine.ts

// Type imports for TypeScript (erased at runtime)
import type * as TransformersTypes from '@huggingface/transformers';

// Lazy-loaded module
let transformers: typeof TransformersTypes | null = null;

/**
 * Load Transformers.js from CDN at runtime
 * Uses jsDelivr's esm.run for browser-compatible ESM
 */
async function loadTransformers(): Promise<typeof TransformersTypes> {
  if (transformers) return transformers;

  console.log('[EmbeddingEngine] Loading Transformers.js from CDN...');

  try {
    // Dynamic import from CDN - works in Electron's renderer
    // @ts-ignore - TypeScript doesn't understand CDN URLs
    const module = await import('https://esm.run/@huggingface/transformers');

    transformers = module as typeof TransformersTypes;

    if (!transformers.pipeline) {
      throw new Error('pipeline not found in module');
    }

    console.log('[EmbeddingEngine] Transformers.js loaded from CDN');
    return transformers;
  } catch (error) {
    console.error('[EmbeddingEngine] CDN load failed:', error);
    throw new Error(`Failed to load Transformers.js: ${error}`);
  }
}
```

**esbuild Configuration:** Already configured in your `esbuild.config.mjs`:
```javascript
external: [
  // ... existing externals
  "@xenova/transformers"  // Already marked external!
]
```

### 9.2 Web Workers Limitations

**Challenge:** Obsidian's sandboxed Electron blocks local module bundling in workers.

**Two Options:**

**Option A: Main Thread (Simpler, Recommended for Embeddings)**
```typescript
// Embeddings are less compute-intensive than LLM inference
// Main thread execution is acceptable for small models like all-MiniLM-L6-v2
// WASM runs in its own thread anyway

class EmbeddingEngine {
  private extractor: any = null;

  async initialize(): Promise<void> {
    const tf = await loadTransformers();

    // This blocks briefly but WASM inference is fast (~50-100ms per note)
    this.extractor = await tf.pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
  }
}
```

**Option B: Blob URL Worker (For UI Responsiveness)**
```typescript
// Following WebLLMWorkerService pattern
class EmbeddingWorkerService {
  private worker: Worker | null = null;

  async initialize(): Promise<void> {
    const workerCode = this.buildWorkerCode();
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);

    this.worker = new Worker(workerUrl);
    URL.revokeObjectURL(workerUrl); // Clean up after worker starts
  }

  private buildWorkerCode(): string {
    return `
// Embedding Worker - loads Transformers.js from CDN
importScripts('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3/dist/transformers.min.js');

let extractor = null;

self.onmessage = async function(event) {
  const { type, id, payload } = event.data;

  if (type === 'init') {
    extractor = await transformers.pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
    self.postMessage({ type: 'ready', id });
  }

  if (type === 'embed') {
    const output = await extractor(payload.text, {
      pooling: 'mean',
      normalize: true
    });
    self.postMessage({
      type: 'result',
      id,
      payload: { embedding: Array.from(output.data) }
    });
  }
};
`;
  }
}
```

### 9.3 Model Caching Location

**Challenge:** Where to store downloaded ONNX model files?

**Transformers.js Default Behavior:**
- Uses browser's Cache API (IndexedDB)
- Model persists across sessions
- No need for custom caching logic

**Alternative for Vault Storage:**
```typescript
// Store model in vault's .nexus folder (like cache.db)
const MODEL_CACHE_PATH = '.nexus/models/all-MiniLM-L6-v2';

// Check if model exists locally before CDN download
async function getModelFromCache(): Promise<ArrayBuffer | null> {
  try {
    const exists = await app.vault.adapter.exists(MODEL_CACHE_PATH);
    if (exists) {
      return await app.vault.adapter.readBinary(MODEL_CACHE_PATH);
    }
  } catch (e) {
    console.warn('Model cache read failed:', e);
  }
  return null;
}
```

### 9.4 Memory Management

**Electron-Specific Concerns:**
- Electron renderer has memory limits (~512MB-2GB depending on system)
- Model stays in memory once loaded (~50-100MB for all-MiniLM-L6-v2)
- Embedding vectors are small (~1.5KB each)

**Best Practices:**
```typescript
class EmbeddingEngine {
  private extractor: any = null;
  private isDisposed = false;

  /**
   * Dispose of the model to free GPU/WASM memory
   * Call when plugin unloads
   */
  async dispose(): Promise<void> {
    if (this.extractor) {
      // Transformers.js models can be garbage collected
      // by removing references
      this.extractor = null;
      this.isDisposed = true;

      // Force garbage collection hint (Electron-specific)
      if (global.gc) {
        global.gc();
      }
    }
  }
}
```

### 9.5 Background Processing

**Follow existing BackgroundProcessor pattern:**
```typescript
// Prevent blocking Obsidian startup
startBackgroundIndexing(): void {
  // Wait for Obsidian to be fully loaded (like BackgroundProcessor)
  setTimeout(async () => {
    try {
      await this.embeddingService.initialize();

      // Index notes in background with UI yields
      const allNotes = this.app.vault.getMarkdownFiles();
      await this.embeddingQueue.enqueue(allNotes.map(f => f.path));
    } catch (error) {
      console.error('Background indexing failed:', error);
    }
  }, 3000); // 3s delay like other background tasks
}
```

### 9.6 Platform-Specific Notes

| Platform | Consideration |
|----------|---------------|
| **macOS (Apple Silicon)** | WebGPU available but WASM is sufficient for embeddings |
| **macOS (Intel)** | WASM works well, no WebGPU |
| **Windows** | WASM works, WebGPU depends on GPU drivers |
| **Linux** | WASM works, WebGPU limited support |
| **Mobile (iOS/Android)** | WASM works but memory constrained, consider lazy loading |

### 9.7 Vault Events Integration

**Use Obsidian's event system (already in place):**
```typescript
// From CacheManager.ts pattern
class EmbeddingWatcher {
  registerEvents(vault: Vault): void {
    // These are the same events used by your existing sync system
    vault.on('create', (file) => this.onFileCreated(file));
    vault.on('modify', (file) => this.onFileModified(file));
    vault.on('delete', (file) => this.onFileDeleted(file));
    vault.on('rename', (file, oldPath) => this.onFileRenamed(file, oldPath));
  }

  // Debounce to avoid re-embedding during active typing
  private onFileModified = debounce((file: TFile) => {
    if (file.extension === 'md') {
      this.scheduleReembedding(file.path);
    }
  }, 2000);
}
```

### 9.8 Error Handling for Network Issues

**Handle offline scenarios gracefully:**
```typescript
async initialize(): Promise<void> {
  try {
    await loadTransformers();
  } catch (error) {
    if (error.message.includes('fetch') || error.message.includes('network')) {
      // CDN unavailable - try offline mode
      console.warn('[EmbeddingEngine] CDN unavailable, embeddings disabled');
      this.isOffline = true;
      return;
    }
    throw error;
  }
}

async embedNote(path: string): Promise<void> {
  if (this.isOffline) {
    // Queue for later when online
    this.offlineQueue.push(path);
    return;
  }
  // ... normal embedding logic
}
```

---

## 10. Summary

**Recommended Approach:**
1. Use **Transformers.js** with `Xenova/all-MiniLM-L6-v2` for local embedding generation
2. Store embeddings in **SQLite as BLOB** (works with existing sql.js)
3. Implement **JavaScript-based cosine similarity** search
4. **Treat each note as one embedding** (no chunking)
5. **Watch file changes** to update embeddings incrementally

**Key Benefits:**
- No external API dependencies
- Works offline
- Privacy-preserving (all local)
- Semantic search capabilities
- Similar note discovery
- Enhanced context selection for chat

---

## Sources

- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [Transformers.js Documentation](https://huggingface.co/docs/transformers.js/en/index)
- [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
- [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- [LangChain Transformers.js Integration](https://js.langchain.com/docs/integrations/text_embedding/transformers/)
