import os from "os";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { pipeline, Pipeline } from "@xenova/transformers";
import { QdrantClient } from "@qdrant/js-client-rest";

const qdrant = new QdrantClient({ url: "http://localhost:6333" });
const COLLECTION_NAME = "docs_chunks";

let embedder: any = null;

/**
 * Search Qdrant for similar vectors
 * @param embedding The query embedding vector
 * @param limit Number of results to return
 * @returns Array of search results with payload and score
 */
export async function searchQdrantByEmbedding(
  embedding: number[],
  limit: number
): Promise<
  {
    id: string;
    score: number;
    payload: Record<string, any>;
  }[]
> {
  const results = await qdrant.search(COLLECTION_NAME, {
    vector: embedding,
    limit,
    with_payload: true,
  });

  return results.map((r: any) => ({
    id: r.id,
    score: r.score,
    payload: r.payload,
  }));
}

/**
 * Perform multi-query search, deduplicate, and sort results
 * @param queries List of query strings
 * @param perQueryLimit Number of results per query
 * @returns Sorted, deduplicated search results
 */
export async function multiQueryQdrantSearch(
  queries: string[],
  perQueryLimit: number = 3
): Promise<
  {
    id: string;
    score: number;
    payload: Record<string, any>;
  }[]
> {
  await loadEmbedder();

  const allResults: {
    id: string;
    score: number;
    payload: Record<string, any>;
  }[] = [];

  for (const query of queries) {
    const embedding = await embedChunk(query);
    const results = await searchQdrantByEmbedding(embedding, perQueryLimit);
    allResults.push(...results);
  }

  // Deduplicate by unique chunk_id or content hash
  const seen = new Set<string>();
  const uniqueResults = allResults.filter((r) => {
    const key = r.payload.chunk_id || r.payload.content;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by descending score
  uniqueResults.sort((a, b) => b.score - a.score);

  return uniqueResults;
}

/**
 * Loads the all-MiniLM-L6-v2 embedding model using @xenova/transformers.
 * Call this once before generating embeddings.
 */
export async function loadEmbedder() {
  if (!embedder) {
    embedder = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
}

/**
 * Generates an embedding vector for a given text chunk.
 * Make sure to call loadEmbedder() before using this.
 * @param text The input text chunk
 * @returns Promise<number[]> The embedding vector
 */
export async function embedChunk(text: string): Promise<number[]> {
  if (!embedder) {
    throw new Error("Embedder not loaded. Call loadEmbedder() first.");
  }
  const output = await embedder(text, { pooling: "mean", normalize: true });
  // output[0] is a Tensor object, convert its data to a plain array
  const tensor = output[0];
  return Array.from(tensor.data);
}

export interface ChunkedLLMReadable {
  url: string;
  content: string;
  timestamp: Date;
  chunkId?: string; // optional unique chunk identifier
}

/**
 * Saves url parsed content to disk
 */
export const saveContentToDisk = (url: string, content: ChunkedLLMReadable) => {
  const safeFileName = url.replace(/[^a-zA-Z0-9-_]/g, "_");
  const directory = path.join(os.homedir(), "data");
  const filePath = path.join(directory, `${safeFileName}.json`);

  // Ensure the directory exists before writing
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), {
    encoding: "utf8",
  });
};

/**
 * Splits markdown text into overlapping chunks based on word count.
 * Approximate target: 400 tokens (~500 words) with 50 token (~65 word) overlap.
 *
 * @param {string} markdown - The markdown text to split.
 * @returns {string[]} Array of chunk strings.
 */
export function chunkMarkdownSlidingWindow(markdown: string): string[] {
  const words = markdown.split(/\s+/);
  const chunkSize = 500; // ~400 tokens
  const overlap = 65; // ~50 tokens
  const chunks: string[] = [];

  for (let start = 0; start < words.length; start += chunkSize - overlap) {
    const end = Math.min(start + chunkSize, words.length);
    const chunk = words.slice(start, end).join(" ");
    chunks.push(chunk);
    if (end === words.length) break;
  }

  return chunks;
}

/**
 * Chunks markdown, generates embeddings, and saves to Qdrant
 * @param url The page URL
 * @param markdown The markdown content
 * @param timestamp The timestamp
 */
export async function saveChunksToQdrant(
  url: string,
  markdown: string,
  timestamp: Date
) {
  await loadEmbedder();

  const chunks = chunkMarkdownSlidingWindow(markdown);
  // Build the list of vectors/points
  const chunkEmbeddings = await Promise.all(
    chunks.map((chunkText) => embedChunk(chunkText))
  );
  const allPoints = chunkEmbeddings.map((embedding, idx) => ({
    id: crypto.randomUUID(),
    vector: embedding,
    payload: {
      url,
      chunk_id: `${url}#chunk-${idx}`,
      content: chunks[idx],
      timestamp: timestamp.toISOString(),
    },
  }));

  // Optionally split into batches of e.g. 20
  const BATCH_SIZE = 20;
  for (let i = 0; i < allPoints.length; i += BATCH_SIZE) {
    const batch = allPoints.slice(i, i + BATCH_SIZE);
    try {
      console.log(`Upserting batch from index ${i}...`);
      await qdrant.upsert(COLLECTION_NAME, { points: batch });
    } catch (err) {
      console.error("Error upserting to Qdrant:", err);
      // You could either continue or break out here, depending on your needs
    }
  }
}
