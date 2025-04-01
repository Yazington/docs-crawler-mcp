import * as fs from "fs";
import * as path from "path";
import { OpenAI } from "openai";
import { INDEX_DIR, ensureDirectory, logger } from "./utils.js";

// Types
export interface DocumentData {
  id: string;
  url: string;
  title: string;
  content: string;
  embedding?: number[];
}

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  content: string;
  distance: number;
}

// The IndexDatabase is a simple alternative to the vector database
// It stores documents in individual files and provides a search capability
// without relying on external vector database libraries
export class IndexDatabase {
  private openai: OpenAI | null = null;
  private static instance: IndexDatabase | null = null;
  private dataDir: string;
  private indexDir: string;
  private readonly embeddingModel: string = "text-embedding-3-small";

  private constructor(dataDir: string = INDEX_DIR) {
    this.dataDir = dataDir;
    this.indexDir = dataDir; // Use the directory directly, no need for a nested "index" folder
  }

  /**
   * Get singleton instance of the database
   */
  public static async getInstance(
    dataDir: string = INDEX_DIR
  ): Promise<IndexDatabase> {
    if (!IndexDatabase.instance) {
      IndexDatabase.instance = new IndexDatabase(dataDir);
      await IndexDatabase.instance.initialize();
    }
    return IndexDatabase.instance;
  }

  /**
   * Initialize the database and OpenAI client
   */
  private async initialize(): Promise<void> {
    logger.info("IndexDB", `Initializing index database at ${this.dataDir}`);

    // Ensure the index directory exists
    await ensureDirectory(this.indexDir);

    // Initialize OpenAI client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(
        "[IndexDB] Warning: OPENAI_API_KEY not found in environment"
      );
    }

    this.openai = new OpenAI({
      apiKey: apiKey || "dummy-key",
    });
  }

  /**
   * Create vector embeddings for text
   */
  /**
   * Split text into chunks of roughly equal size
   */
  private splitIntoChunks(text: string, maxChunkSize: number = 6000): string[] {
    // Split into sentences first to preserve context
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks: string[] = [];
    let currentChunk = "";

    for (const sentence of sentences) {
      // If adding this sentence would exceed chunk size, start a new chunk
      if (
        (currentChunk + sentence).length > maxChunkSize &&
        currentChunk.length > 0
      ) {
        chunks.push(currentChunk.trim());
        currentChunk = "";
      }
      currentChunk += sentence + " ";
    }

    // Add the last chunk if not empty
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Create embeddings for text, handling chunking if needed
   */
  private async createEmbedding(text: string): Promise<number[]> {
    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const openai = this.openai; // Store reference to avoid null checks

    try {
      // Split text into chunks if it's too long
      const chunks = this.splitIntoChunks(text);

      // If only one chunk, process normally
      if (chunks.length === 1) {
        const response = await openai.embeddings.create({
          model: this.embeddingModel,
          input: chunks[0],
          dimensions: 1536,
        });
        return response.data[0].embedding;
      }

      // For multiple chunks, get embeddings for each and average them
      console.error(`[IndexDB] Text split into ${chunks.length} chunks`);
      const embeddings = await Promise.all(
        chunks.map(async (chunk) => {
          const response = await openai.embeddings.create({
            model: this.embeddingModel,
            input: chunk,
            dimensions: 1536,
          });
          return response.data[0].embedding;
        })
      );

      // Average the embeddings
      const averageEmbedding = new Array(1536).fill(0);
      for (const embedding of embeddings) {
        for (let i = 0; i < embedding.length; i++) {
          averageEmbedding[i] += embedding[i] / embeddings.length;
        }
      }

      return averageEmbedding;
    } catch (error) {
      console.error("[IndexDB] Error creating embedding:", error);
      // Return a placeholder embedding in case of failure
      return new Array(1536).fill(0);
    }
  }

  /**
   * Index documents from the source directory
   */
  public async indexDocuments(sourceDir: string): Promise<number> {
    console.error(`[IndexDB] Indexing documents from ${sourceDir}`);

    // Get all JSON files from directory
    const absoluteSourceDir = path.resolve(process.cwd(), sourceDir);
    const files = fs
      .readdirSync(absoluteSourceDir)
      .filter((file) => file.endsWith(".json"));

    if (files.length === 0) {
      console.error("[IndexDB] No JSON files found in directory");
      return 0;
    }

    console.error(`[IndexDB] Found ${files.length} JSON files to process`);

    // Process files in batches (to avoid memory issues)
    const batchSize = 10;
    let totalProcessed = 0;

    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      const chunkPromises = batch.map(async (file) => {
        const filePath = path.join(absoluteSourceDir, file);
        try {
          const fileContent = fs.readFileSync(filePath, "utf8");
          const document = JSON.parse(fileContent);

          // Skip empty content
          if (!document.content || document.content.trim() === "") {
            return null;
          }

          // Create embedding for the document
          const embedding = await this.createEmbedding(document.content);

          // Create a document data object
          const documentData: DocumentData = {
            id: document.url || file.replace(".json", ""),
            url: document.url || "",
            title: document.title || "Untitled",
            content: document.content,
            embedding: embedding,
          };

          // Save to the index
          const indexPath = path.join(
            this.indexDir,
            `${path.basename(file, ".json")}.index.json`
          );
          await fs.promises.writeFile(
            indexPath,
            JSON.stringify(documentData, null, 2)
          );

          return documentData;
        } catch (error) {
          console.error(`[IndexDB] Error processing file ${file}:`, error);
          return null;
        }
      });

      // Wait for batch to complete
      const results = await Promise.all(chunkPromises);
      const validResults = results.filter((r) => r !== null);
      totalProcessed += validResults.length;

      console.error(
        `[IndexDB] Indexed batch of ${validResults.length} documents (total: ${totalProcessed})`
      );
    }

    console.error(
      `[IndexDB] Indexing complete. Total documents indexed: ${totalProcessed}`
    );
    return totalProcessed;
  }

  /**
   * Compute cosine similarity between two vectors
   */
  private computeCosineSimilarity(vec1: number[], vec2: number[]): number {
    // Calculate dot product
    let dotProduct = 0;
    let mag1 = 0;
    let mag2 = 0;

    for (let i = 0; i < vec1.length && i < vec2.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      mag1 += vec1[i] * vec1[i];
      mag2 += vec2[i] * vec2[i];
    }

    mag1 = Math.sqrt(mag1);
    mag2 = Math.sqrt(mag2);

    if (mag1 === 0 || mag2 === 0) {
      return 0;
    }

    return dotProduct / (mag1 * mag2);
  }

  /**
   * Search the index database
   */
  public async search(
    query: string,
    limit: number = 5
  ): Promise<SearchResult[]> {
    console.error(`[IndexDB] Searching for: "${query}"`);

    // Create embedding for the query
    const queryEmbedding = await this.createEmbedding(query);

    // Get all indexed documents
    try {
      const indexFiles = fs
        .readdirSync(this.indexDir)
        .filter((file) => file.endsWith(".index.json"));

      console.error(`[IndexDB] Found ${indexFiles.length} indexed documents`);

      // If no documents, return empty result
      if (indexFiles.length === 0) {
        return [];
      }

      // Load all documents and calculate similarities
      const documents: Array<DocumentData & { similarity: number }> = [];

      for (const file of indexFiles) {
        try {
          const filePath = path.join(this.indexDir, file);
          const fileContent = fs.readFileSync(filePath, "utf8");
          const doc = JSON.parse(fileContent) as DocumentData;

          // Skip if no embedding
          if (!doc.embedding || !Array.isArray(doc.embedding)) {
            continue;
          }

          // Calculate similarity
          const similarity = this.computeCosineSimilarity(
            queryEmbedding,
            doc.embedding
          );

          documents.push({
            ...doc,
            similarity,
          });
        } catch (error) {
          console.error(`[IndexDB] Error processing file ${file}:`, error);
          continue;
        }
      }

      // Sort by similarity (highest first) and take top results
      const topResults = documents
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      // Convert to SearchResult format
      const searchResults: SearchResult[] = topResults.map((doc) => ({
        id: doc.id,
        url: doc.url,
        title: doc.title,
        content: doc.content,
        distance: 1 - doc.similarity, // Convert similarity to distance
      }));

      console.error(
        `[IndexDB] Search returned ${searchResults.length} results`
      );
      return searchResults;
    } catch (error) {
      console.error("[IndexDB] Error searching index:", error);
      return [];
    }
  }

  /**
   * Check database status
   */
  public async getStatus(): Promise<{
    isInitialized: boolean;
    documentsCount: number;
    dataDir: string;
  }> {
    try {
      let documentsCount = 0;
      if (fs.existsSync(this.indexDir)) {
        const files = fs
          .readdirSync(this.indexDir)
          .filter((file) => file.endsWith(".index.json"));
        documentsCount = files.length;
      }

      return {
        isInitialized: fs.existsSync(this.indexDir),
        documentsCount,
        dataDir: this.dataDir,
      };
    } catch (error) {
      console.error("[IndexDB] Error getting status:", error);
      return {
        isInitialized: false,
        documentsCount: 0,
        dataDir: this.dataDir,
      };
    }
  }
}
