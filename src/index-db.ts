import * as fs from "fs";
import * as path from "path";
import { OpenAI } from "openai";
import { INDEX_DIR, ensureDirectory, logger } from "./utils.js";

// Types
export interface DocumentChunk {
  id: string;
  url: string;
  title: string;
  content: string;
  embedding: number[];
}

export interface SearchResult {
  id: string;
  url: string;
  title: string;
  content: string;
  distance: number;
  chunkIndex: number;
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
  private async createEmbeddings(text: string): Promise<number[][]> {
    if (!this.openai) {
      throw new Error("OpenAI client not initialized");
    }

    const openai = this.openai;
    const chunks = this.splitIntoChunks(text);

    try {
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

      return embeddings;
    } catch (error) {
      console.error("[IndexDB] Error creating embeddings:", error);
      return chunks.map(() => new Array(1536).fill(0));
    }
  }

  /**
   * Index documents from the source directory
   */
  public async indexDocuments(sourceDir: string): Promise<number> {
    console.error(`[IndexDB] Indexing documents from ${sourceDir}`);

    const absoluteSourceDir = path.resolve(process.cwd(), sourceDir);

    // Check for both .json and .jsonX files
    const files = fs
      .readdirSync(absoluteSourceDir)
      .filter((file) => file.endsWith(".json") || file.endsWith(".jsonX"));

    if (files.length === 0) {
      console.error("[IndexDB] No JSON files found in directory");
      return 0;
    }

    console.error(`[IndexDB] Found ${files.length} JSON files to process`);

    let totalProcessed = 0;

    for (const file of files) {
      const filePath = path.join(absoluteSourceDir, file);
      try {
        const fileContent = fs.readFileSync(filePath, "utf8");
        let document;
        try {
          // Handle potential JSON formatting issues
          document = JSON.parse(fileContent);
        } catch (parseError) {
          console.error(`[IndexDB] Error parsing JSON in ${file}:`, parseError);
          // Try to fix common JSON issues - missing opening brace
          if (fileContent.trim().startsWith('"')) {
            try {
              document = JSON.parse(`{${fileContent}}`);
              console.error(`[IndexDB] Fixed JSON format for ${file}`);
            } catch (e) {
              console.error(`[IndexDB] Failed to fix JSON in ${file}:`, e);
              continue;
            }
          } else {
            continue;
          }
        }

        if (!document.content || document.content.trim() === "") {
          console.error(`[IndexDB] No content found in ${file}`);
          continue;
        }

        const chunks = this.splitIntoChunks(document.content);
        const embeddings = await this.createEmbeddings(document.content);

        const documentChunks: DocumentChunk[] = chunks.map((chunk, index) => ({
          id: `${document.url || file.replace(".json", "")}_chunk_${index}`,
          url: document.url || "",
          title: document.title || "Untitled",
          content: chunk,
          embedding: embeddings[index],
        }));

        // Handle both .json and .jsonX extensions for index path generation
        const baseFileName = file.endsWith(".jsonX")
          ? path.basename(file, ".jsonX")
          : path.basename(file, ".json");

        const indexPath = path.join(
          this.indexDir,
          `${baseFileName}.index.json`
        );
        await fs.promises.writeFile(
          indexPath,
          JSON.stringify(documentChunks, null, 2)
        );

        totalProcessed += documentChunks.length;
        console.error(
          `[IndexDB] Indexed ${documentChunks.length} chunks for ${file}`
        );
      } catch (error) {
        console.error(`[IndexDB] Error processing file ${file}:`, error);
      }
    }

    console.error(
      `[IndexDB] Indexing complete. Total chunks indexed: ${totalProcessed}`
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
    limit: number = 5,
    baseUrl?: string
  ): Promise<SearchResult[]> {
    console.error(
      `[IndexDB] Searching for: "${query}" with base URL: ${
        baseUrl || "Not specified"
      }`
    );

    try {
      // Generate embeddings with error handling
      let queryEmbedding;
      try {
        queryEmbedding = await this.createEmbeddings(query);
        if (
          !queryEmbedding ||
          !Array.isArray(queryEmbedding) ||
          queryEmbedding.length === 0
        ) {
          console.error(
            "[IndexDB] Failed to create valid embeddings for the query"
          );
          return [];
        }
      } catch (error) {
        console.error(
          "[IndexDB] Error creating embeddings for search query:",
          error
        );
        return [];
      }

      const indexFiles = fs
        .readdirSync(this.indexDir)
        .filter((file) => file.endsWith(".index.json"));

      console.error(`[IndexDB] Found ${indexFiles.length} indexed documents`);

      if (indexFiles.length === 0) {
        return [];
      }

      const allChunks: Array<DocumentChunk & { similarity: number }> = [];

      for (const file of indexFiles) {
        try {
          const filePath = path.join(this.indexDir, file);
          const fileContent = fs.readFileSync(filePath, "utf8");
          let chunks;

          try {
            chunks = JSON.parse(fileContent) as DocumentChunk[];

            // Validate chunks is an array
            if (!Array.isArray(chunks)) {
              console.error(
                `[IndexDB] Invalid chunks format in ${file}, expected array but got ${typeof chunks}`
              );
              continue;
            }
          } catch (parseError) {
            console.error(
              `[IndexDB] Error parsing index file ${file}:`,
              parseError
            );
            continue;
          }

          for (const chunk of chunks) {
            // Skip if chunk doesn't have required properties
            if (
              !chunk.url ||
              !chunk.embedding ||
              !Array.isArray(chunk.embedding)
            ) {
              continue;
            }

            // Skip if not matching baseUrl filter
            if (baseUrl && !chunk.url.startsWith(baseUrl)) {
              continue;
            }

            try {
              const similarity = this.computeCosineSimilarity(
                queryEmbedding[0],
                chunk.embedding
              );

              allChunks.push({
                ...chunk,
                similarity,
                // Ensure these properties exist
                title: chunk.title || "Untitled",
                content: chunk.content || "",
              });
            } catch (simError) {
              console.error(
                `[IndexDB] Error computing similarity for chunk:`,
                simError
              );
            }
          }
        } catch (fileError) {
          console.error(
            `[IndexDB] Error processing index file ${file}:`,
            fileError
          );
        }
      }

      const topResults = allChunks
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      const searchResults: SearchResult[] = topResults.map((chunk, index) => ({
        id: chunk.id,
        url: chunk.url,
        title: chunk.title,
        content: chunk.content,
        distance: 1 - chunk.similarity,
        chunkIndex: index,
      }));

      console.error(
        `[IndexDB] Search returned ${searchResults.length} results`
      );
      searchResults.forEach((result, index) => {
        console.error(
          `[IndexDB] Result ${index + 1}: ${result.url} (distance: ${
            result.distance
          }, chunk: ${result.chunkIndex})`
        );
      });
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
