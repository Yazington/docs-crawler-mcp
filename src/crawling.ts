import {
  ChunkedLLMReadable,
  saveContentToDisk,
  chunkMarkdownSlidingWindow,
  saveChunksToQdrant,
  multiQueryQdrantSearch,
} from "./data.js";
import { Browser } from "puppeteer";
import {
  extractAllUrlsWithSameBaseUrl,
  extractMarkdown,
  launchBrowser,
  navigateAndWait,
} from "./browser.js";
/**
 * Crawls a single URL using an existing browser instance.
 * - Navigates to the URL and waits for optional selector.
 * - Extracts Markdown content.
 * - Saves content to disk.
 * - Extracts and returns discovered internal URLs.
 *
 * @param {string} url - The URL to crawl.
 * @param {string | undefined} waitForSelector - Optional CSS selector to wait for.
 * @param {Browser} browser - The Puppeteer Browser instance.
 * @returns {Promise<{ markdown: string; discoveredUrls: string[] }>} The Markdown content and discovered URLs.
 * @throws Will throw if navigation or extraction fails.
 */
export async function crawlSingleUrl(
  url: string,
  waitForSelector: string | undefined,
  browser: Browser
): Promise<{ markdown: string; discoveredUrls: string[] }> {
  const page = await browser.newPage();
  try {
    await navigateAndWait(page, url, waitForSelector);
    const markdown = await extractMarkdown(page);

    const chunks = chunkMarkdownSlidingWindow(markdown);
    const timestamp = new Date();

    chunks.forEach((chunkText, idx) => {
      const chunkData: ChunkedLLMReadable & { chunkId: string } = {
        url,
        content: chunkText,
        timestamp,
        chunkId: `${url}#chunk-${idx}`,
      };
      const chunkUrlForFile = `${url}__chunk${idx}`;
      saveContentToDisk(chunkUrlForFile, chunkData);
    });

    // Save chunks and embeddings to Qdrant
    await saveChunksToQdrant(url, markdown, timestamp);

    const discoveredUrls = await extractAllUrlsWithSameBaseUrl(url, page);
    await page.close();
    return { markdown, discoveredUrls };
  } catch (error) {
    await page.close();
    throw error;
  }
}

/**
 * Recursively crawls URLs discovered from the initial page, respecting depth and page limits.
 *
 * - Skips URLs already visited.
 * - Stops recursion if max depth or max pages reached.
 * - Saves content for each crawled page.
 *
 * @param {string} url - The URL to crawl.
 * @param {string | undefined} waitForSelector - Optional CSS selector to wait for.
 * @param {Browser} browser - The Puppeteer Browser instance.
 * @param {Set<string>} visited - Set of already visited URLs.
 * @param {number} depth - Current recursion depth.
 * @param {number} maxDepth - Maximum allowed recursion depth.
 * @param {{ count: number }} pagesCrawled - Object tracking total pages crawled.
 * @param {number} maxPages - Maximum total pages to crawl.
 * @returns {Promise<void>} Resolves when crawling completes or limits reached.
 */
export async function crawlRecursive(
  url: string,
  waitForSelector: string | undefined,
  browser: Browser,
  visited: Set<string>,
  depth: number,
  maxDepth: number,
  pagesCrawled: { count: number },
  maxPages: number
): Promise<void> {
  if (visited.has(url)) {
    return;
  }
  if (depth > maxDepth) {
    return;
  }
  if (pagesCrawled.count >= maxPages) {
    return;
  }

  visited.add(url);

  let result;
  try {
    result = await crawlSingleUrl(url, waitForSelector, browser);
    pagesCrawled.count++;
  } catch (error) {
    console.error(`Error crawling ${url}:`, error);
    return;
  }

  for (const discoveredUrl of result.discoveredUrls) {
    if (!visited.has(discoveredUrl)) {
      await crawlRecursive(
        discoveredUrl,
        waitForSelector,
        browser,
        visited,
        depth + 1,
        maxDepth,
        pagesCrawled,
        maxPages
      );
    }
  }
}

/**
 * Handles a crawl request for a given URL.
 * - Launches a new browser instance.
 * - Crawls the initial URL and discovered URLs recursively.
 * - Saves content to disk.
 * - Returns the initial page's Markdown content.
 *
 * @param {string} url - The initial URL to crawl.
 * @param {string} [waitForSelector] - Optional CSS selector to wait for.
 * @returns {Promise<{ content: { type: string; text: string }[]; isError?: boolean }>} The initial page's Markdown content, or error info.
 */
export async function crawlWebsite(
  url: string,
  waitForSelector?: string,
  queries?: string[]
): Promise<{
  content: { type: string; text: string }[];
  isError?: boolean;
}> {
  let browser: Browser | undefined;
  let initialMarkdown = "";
  try {
    browser = await launchBrowser();
    const visited = new Set<string>();
    const pagesCrawled = { count: 0 };
    const maxDepth = 2;
    const maxPages = 500;

    const result = await crawlSingleUrl(url, waitForSelector, browser);
    initialMarkdown = result.markdown;
    pagesCrawled.count++;
    visited.add(url);

    for (const discoveredUrl of result.discoveredUrls) {
      await crawlRecursive(
        discoveredUrl,
        waitForSelector,
        browser,
        visited,
        1,
        maxDepth,
        pagesCrawled,
        maxPages
      );
    }

    await browser.close();

    if (queries && Array.isArray(queries) && queries.length > 0) {
      try {
        const results = await multiQueryQdrantSearch(queries, 5);

        return {
          content: results.map((r) => ({
            type: "text",
            text: r.payload.content,
          })),
        };
      } catch (searchError) {
        return {
          content: [
            {
              type: "text",
              text: `Error during Qdrant search: ${
                searchError instanceof Error
                  ? searchError.message
                  : String(searchError)
              }`,
            },
          ],
          isError: true,
        };
      }
    } else {
      return {
        content: [
          {
            type: "text",
            text: initialMarkdown,
          },
        ],
      };
    }
  } catch (error) {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    return {
      content: [
        {
          type: "text",
          text: `Error crawling URL: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
}
