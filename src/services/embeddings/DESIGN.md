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

## 9. Summary

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
