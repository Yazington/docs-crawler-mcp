import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { WebsiteCrawler } from "./crawler.js";
import { IndexDatabase } from "./index-db.js";
import { crawlJobs } from "./types.js";
import {
  INDEX_DIR,
  WEBSITES_DIR,
  DATA_ROOT_DIR,
  formatSearchResult,
  logger,
  getWebsiteDirectory,
  getWebsiteStoragePath,
  listCrawledWebsites,
  ensureDirectory,
} from "./utils.js";

/**
 * All-in-one function that crawls a website, indexes the content, and performs searches
 * Uses persistent storage to cache crawled websites
 */
export async function handleSearchWebsite(args: {
  url: string;
  queries: string[];
  limit?: number;
  forceCrawl?: boolean;
}) {
  const { url, queries, limit = 5, forceCrawl = false } = args;

  if (!url || !queries || !Array.isArray(queries) || queries.length < 3) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "URL and at least 3 diverse search queries are required"
    );
  }

  try {
    logger.info("Search", `Starting all-in-one search for: ${url}`);
    logger.info("Search", `Using provided queries: ${queries.join(", ")}`);

    // Ensure base directories exist
    await ensureDirectory(DATA_ROOT_DIR);
    await ensureDirectory(WEBSITES_DIR);
    await ensureDirectory(INDEX_DIR);

    // Check if website was previously crawled
    let websiteDir = getWebsiteDirectory(url);
    let needsCrawling = forceCrawl || !websiteDir;
    const outputDir = websiteDir || getWebsiteStoragePath(url);

    if (needsCrawling) {
      // Need to crawl the website
      logger.info("Crawler", `Starting crawl of ${url}`);

      // Create website directory if it doesn't exist
      await ensureDirectory(outputDir);

      // Start crawling
      const jobId = Date.now().toString();
      const crawler = new WebsiteCrawler(jobId, url, outputDir);

      logger.info(
        "Crawler",
        "Crawling with enhanced page loading (waiting for all content)"
      );
      await crawler.crawl(); // Wait for crawl to complete

      const job = crawlJobs.get(jobId);
      if (!job || job.status === "failed" || job.errors.length > 0) {
        logger.error("Crawler", `Crawl failed: ${job?.errors.join(", ")}`);
        throw new Error(`Crawl failed: ${job?.errors.join(", ")}`);
      }

      logger.info(
        "Crawler",
        `Crawl completed successfully. Pages processed: ${job.pagesProcessed}`
      );

      // Save metadata
      const metadataPath = path.join(outputDir, "metadata.json");
      const metadata = {
        url,
        crawlDate: new Date().toISOString(),
        pagesCount: job.pagesProcessed,
        jobId,
      };

      await fs.promises.writeFile(
        metadataPath,
        JSON.stringify(metadata, null, 2)
      );

      logger.info("Storage", `Saved website metadata to ${metadataPath}`);
    } else {
      // Website was already crawled before
      try {
        const metadataPath = path.join(websiteDir!, "metadata.json");
        if (fs.existsSync(metadataPath)) {
          const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
          logger.info(
            "Crawler",
            `Using previously crawled content from ${new Date(
              metadata.crawlDate
            ).toLocaleDateString()}`
          );
          logger.info("Crawler", `Pages available: ${metadata.pagesCount}`);
        }
      } catch (error) {
        logger.error("Storage", `Error reading website metadata: ${error}`);
      }
    }

    // Check if the content needs to be indexed
    const db = await IndexDatabase.getInstance();

    // Only index if we just crawled the website or if it was forced
    if (needsCrawling) {
      logger.info("IndexDB", `Indexing crawled content from ${outputDir}`);
      const indexCount = await db.indexDocuments(outputDir);
      logger.info("IndexDB", `Indexed ${indexCount} documents`);
    } else {
      logger.info("IndexDB", `Using existing index for ${url}`);
    }

    // Perform searches with all generated queries
    logger.info(
      "Search",
      `Executing multiple searches with ${queries.length} queries`
    );
    interface SearchResultWithDistance {
      url: string;
      title: string;
      content: string;
      distance: number;
      relevance?: number;
      matchedQueries?: string[];
    }

    interface SearchResultWithRelevance extends SearchResultWithDistance {
      relevance: number;
    }

    const allResults: SearchResultWithRelevance[] = [];

    for (const q of queries) {
      logger.info("Search", `Searching for: "${q}"`);
      const results = await db.search(q, limit);
      logger.info(
        "Search",
        `Found ${results.length} results for query: "${q}"`
      );

      // Add results with relevance score
      allResults.push(
        ...results.map(
          (r: SearchResultWithDistance): SearchResultWithRelevance => ({
            ...r,
            relevance: parseFloat((1 - r.distance).toFixed(4)),
          })
        )
      );
    }

    // Deduplicate results by URL and sort by relevance
    const uniqueResults = Array.from(
      allResults
        .reduce((map, result) => {
          const existing = map.get(result.url);
          if (!existing || result.relevance > existing.relevance) {
            map.set(result.url, result);
          }
          return map;
        }, new Map<string, SearchResultWithRelevance>())
        .values()
    )
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    logger.info("Search", `Returning ${uniqueResults.length} unique results`);

    // Format final results
    return uniqueResults.map((result: SearchResultWithRelevance) => ({
      ...formatSearchResult(result),
      matchedQueries: queries.filter((q) => {
        // Check if content matches query or its key terms
        const content = result.content.toLowerCase();
        const query = q.toLowerCase();

        // Split query into key terms and check each
        const terms = query.split(/\s+/).filter((term) => term.length > 3);
        return terms.some((term) => content.includes(term));
      }),
    }));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Search", `Operation failed: ${errorMessage}`);
    throw new McpError(
      ErrorCode.InternalError,
      `Search operation failed: ${errorMessage}`
    );
  }
}

/**
 * List all crawled websites
 */
export async function handleListCrawledWebsites() {
  try {
    logger.info("Storage", "Listing all crawled websites");
    const websites = await listCrawledWebsites();

    logger.info("Storage", `Found ${websites.length} crawled websites`);

    return websites.map((site) => ({
      url: site.url,
      crawlDate: site.crawlDate.toISOString(),
      pagesCount: site.pagesCount,
    }));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Storage", `Failed to list crawled websites: ${errorMessage}`);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to list crawled websites: ${errorMessage}`
    );
  }
}

/**
 * Force recrawl a website
 */
export async function handleRecrawlWebsite(args: { url: string }) {
  const { url } = args;

  if (!url) {
    throw new McpError(ErrorCode.InvalidParams, "URL is required");
  }

  try {
    // Call handleSearchWebsite with forceCrawl=true and a basic query
    const result = await handleSearchWebsite({
      url,
      queries: ["introduction", "overview", "documentation"],
      forceCrawl: true,
      limit: 1,
    });

    return {
      success: true,
      message: `Website ${url} recrawled successfully`,
      resultsCount: result.length,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Crawler", `Failed to recrawl website: ${errorMessage}`);
    throw new McpError(
      ErrorCode.InternalError,
      `Failed to recrawl website: ${errorMessage}`
    );
  }
}

/**
 * Search directly in existing data without crawling
 */
export async function handleSearchExistingData(args: {
  queries: string[];
  url?: string;
  limit?: number;
}) {
  const { queries, url, limit = 5 } = args;

  if (!queries || !Array.isArray(queries) || queries.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "At least one search query is required"
    );
  }

  try {
    logger.info(
      "Search",
      `Searching existing data with ${queries.length} queries: "${queries.join(
        '", "'
      )}"`
    );

    // If URL is provided, check if it exists in our data
    if (url) {
      const websiteDir = getWebsiteDirectory(url);
      if (!websiteDir) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Website ${url} has not been crawled yet. Use search_website tool first.`
        );
      }

      logger.info("Search", `Limiting search to website: ${url}`);
    }

    // Get database instance
    const db = await IndexDatabase.getInstance();

    // Interface for search results with additional fields
    interface SearchResultWithDistance {
      url: string;
      title: string;
      content: string;
      distance: number;
      relevance?: number;
      matchedQueries?: string[];
    }

    interface SearchResultWithRelevance extends SearchResultWithDistance {
      relevance: number;
    }

    const allResults: SearchResultWithRelevance[] = [];

    // Search for each query
    for (const q of queries) {
      logger.info("Search", `Searching for: "${q}"`);
      const results = await db.search(q, limit);
      logger.info(
        "Search",
        `Found ${results.length} results for query: "${q}"`
      );

      // Add results with relevance score
      allResults.push(
        ...results.map(
          (r: SearchResultWithDistance): SearchResultWithRelevance => ({
            ...r,
            relevance: parseFloat((1 - r.distance).toFixed(4)),
            matchedQueries: [q],
          })
        )
      );
    }

    // Apply URL filtering if needed
    let filteredResults = allResults;
    if (url) {
      filteredResults = allResults.filter((result) =>
        result.url.startsWith(url)
      );
      logger.info(
        "Search",
        `Filtered to ${filteredResults.length} results from ${url}`
      );
    }

    // Deduplicate results by URL and sort by relevance
    const uniqueResults = Array.from(
      filteredResults
        .reduce((map, result) => {
          const existing = map.get(result.url);
          if (!existing) {
            // First time seeing this URL
            map.set(result.url, result);
          } else {
            // We've seen this URL before, keep the higher relevance score
            if (result.relevance > existing.relevance) {
              existing.relevance = result.relevance;
            }
            // Combine the matched queries
            existing.matchedQueries = [
              ...(existing.matchedQueries || []),
              ...(result.matchedQueries || []),
            ].filter((q, i, arr) => arr.indexOf(q) === i); // Remove duplicates
            map.set(result.url, existing);
          }
          return map;
        }, new Map<string, SearchResultWithRelevance>())
        .values()
    )
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    logger.info("Search", `Returning ${uniqueResults.length} unique results`);

    // Format final results
    return uniqueResults.map((result) => formatSearchResult(result));
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Search", `Operation failed: ${errorMessage}`);
    throw new McpError(
      ErrorCode.InternalError,
      `Search operation failed: ${errorMessage}`
    );
  }
}
