import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { URL } from "url";
import crypto from "crypto";

// Base directory for persistent storage
export const DATA_ROOT_DIR = path.join(
  os.homedir(),
  "Documents",
  "MCP",
  "docs-crawler-data"
);
export const WEBSITES_DIR = path.join(DATA_ROOT_DIR, "websites");
export const INDEX_DIR = path.join(DATA_ROOT_DIR, "index");

/**
 * Normalize a URL by removing trailing slashes and hash fragments
 */
export function normalizeUrl(url: string, baseUrl: URL): string {
  try {
    const parsed = new URL(url, baseUrl);
    return parsed.href.replace(/\/$/, "").split("#")[0];
  } catch {
    return "";
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    if (!fs.existsSync(dirPath)) {
      console.error(`[Storage] Creating directory: ${dirPath}`);
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create directory ${dirPath}: ${errorMessage}`);
  }
}

/**
 * Save content to a file with proper error handling
 */
export async function saveToFile(
  filePath: string,
  content: string
): Promise<void> {
  try {
    // Ensure the directory exists
    await ensureDirectory(path.dirname(filePath));

    // Write file with explicit encoding
    await fs.promises.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "w",
    });

    // Verify file was written
    if (fs.existsSync(filePath)) {
      console.error(`[Storage] Successfully saved to ${filePath}`);
      console.error(`[Storage] File size: ${fs.statSync(filePath).size} bytes`);
    } else {
      throw new Error(`File was not created at ${filePath}`);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to save ${filePath}: ${errorMessage}`);
  }
}

/**
 * Format a search result for display
 * @param result The search result to format
 * @param maxContentLength Maximum length for content (default 800 characters)
 */
export function formatSearchResult(
  result: {
    url: string;
    title: string;
    content: string;
    distance: number;
    matchedQueries?: string[];
  },
  maxContentLength: number = 1500
) {
  // Limit content size to maxContentLength without adding truncation indicators
  let limitedContent = result.content;
  if (limitedContent.length > maxContentLength) {
    // Find a good breakpoint near the specified length
    const breakPoint = findNaturalBreakpoint(limitedContent, maxContentLength);
    limitedContent = limitedContent.substring(0, breakPoint);
  }

  return {
    url: result.url,
    title: result.title,
    content: limitedContent,
    relevance: (1 - result.distance).toFixed(4),
    matchedQueries: result.matchedQueries || [],
  };
}

/**
 * Find a natural breakpoint in text near the specified position
 * Prefers paragraph breaks > sentence ends > word boundaries
 */
function findNaturalBreakpoint(text: string, nearPosition: number): number {
  // Don't go over text length
  const maxPosition = Math.min(nearPosition, text.length);

  // Look for paragraph breaks within 20% of target position
  const paragraphSearchRange = Math.floor(maxPosition * 0.2);
  const paragraphBreakIndex = text.lastIndexOf("\n\n", maxPosition);
  if (paragraphBreakIndex >= maxPosition - paragraphSearchRange) {
    return paragraphBreakIndex + 2; // Include the paragraph break
  }

  // Look for sentence ends within 15% of target position
  const sentenceSearchRange = Math.floor(maxPosition * 0.15);
  let sentenceBreakIndex = -1;

  // Check for common sentence endings
  for (const endChar of [". ", "! ", "? "]) {
    const index = text.lastIndexOf(endChar, maxPosition);
    if (
      index > sentenceBreakIndex &&
      index >= maxPosition - sentenceSearchRange
    ) {
      sentenceBreakIndex = index;
    }
  }

  if (sentenceBreakIndex > 0) {
    return sentenceBreakIndex + 1; // Include the period but not the space
  }

  // Fall back to word boundary within 10% of target position
  const wordSearchRange = Math.floor(maxPosition * 0.1);
  const wordBreakIndex = text.lastIndexOf(" ", maxPosition);
  if (wordBreakIndex >= maxPosition - wordSearchRange) {
    return wordBreakIndex;
  }

  // If all else fails, just truncate at the specified position
  return maxPosition;
}

/**
 * Convert a URL to a safe directory name
 * @param url The URL to convert to a directory name
 * @returns A safe directory name for the URL
 */
export function urlToDirectoryName(url: string): string {
  // Create a hash of the URL to ensure uniqueness and avoid special characters
  const urlHash = crypto
    .createHash("md5")
    .update(url)
    .digest("hex")
    .substring(0, 8);

  // Extract domain name for human readability
  let domain = "";
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, "_");
  } catch (e) {
    domain = "unknown_domain";
  }

  // Combine domain and hash
  return `${domain}_${urlHash}`;
}

/**
 * Check if a website has been crawled before
 * @param url The URL to check
 * @returns The path to the website directory if it exists, null otherwise
 */
export function getWebsiteDirectory(url: string): string | null {
  const dirName = urlToDirectoryName(url);
  const dirPath = path.join(WEBSITES_DIR, dirName);

  if (fs.existsSync(dirPath)) {
    return dirPath;
  }

  return null;
}

/**
 * Get the path to store a website's data
 * @param url The URL of the website
 * @returns The path to the website directory
 */
export function getWebsiteStoragePath(url: string): string {
  const dirName = urlToDirectoryName(url);
  return path.join(WEBSITES_DIR, dirName);
}

/**
 * List all crawled websites
 * @returns Array of crawled website info objects
 */
export async function listCrawledWebsites(): Promise<
  Array<{
    url: string;
    crawlDate: Date;
    pagesCount: number;
    directoryPath: string;
  }>
> {
  // Ensure the directory exists
  await ensureDirectory(WEBSITES_DIR);

  // List subdirectories
  const dirs = fs
    .readdirSync(WEBSITES_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  // Get metadata for each website
  const websites = [];

  for (const dir of dirs) {
    const dirPath = path.join(WEBSITES_DIR, dir);
    try {
      // Look for metadata.json
      const metadataPath = path.join(dirPath, "metadata.json");
      if (fs.existsSync(metadataPath)) {
        const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
        websites.push({
          url: metadata.url,
          crawlDate: new Date(metadata.crawlDate),
          pagesCount: metadata.pagesCount,
          directoryPath: dirPath,
        });
      }
    } catch (error) {
      logger.error(
        "Storage",
        `Error reading website metadata for ${dir}: ${error}`
      );
    }
  }

  return websites;
}

/**
 * Logger utility for consistent logging format
 */
export const logger = {
  info: (context: string, message: string) =>
    console.error(`[${context}] ${message}`),
  error: (context: string, message: string) =>
    console.error(`[Error:${context}] ${message}`),
  debug: (context: string, message: string) =>
    console.error(`[Debug:${context}] ${message}`),
};
