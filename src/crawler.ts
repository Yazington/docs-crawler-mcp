import axios from "axios";
import * as cheerio from "cheerio";
import PQueue from "p-queue";
import * as path from "path";
import { URL } from "url";
import { CrawlJob, PageResult } from "./types.js";
import { crawlJobs } from "./types.js";
import { logger, normalizeUrl, saveToFile } from "./utils.js";

export class WebsiteCrawler {
  private queue: PQueue;
  private visited: Set<string>;
  private job: CrawlJob;
  private baseUrl: URL;

  constructor(jobId: string, baseUrl: string, outputDir: string) {
    this.queue = new PQueue({ concurrency: 2 });
    this.visited = new Set();
    this.baseUrl = new URL(baseUrl);

    this.job = {
      id: jobId,
      baseUrl,
      status: "running",
      pagesProcessed: 0,
      errors: [],
      startTime: new Date(),
      outputDir,
    };
    crawlJobs.set(jobId, this.job);
  }

  private async processPage(url: string): Promise<PageResult | null> {
    logger.info("Crawler", `Processing page: ${url}`);
    try {
      const response = await axios.get(url);
      const $ = cheerio.load(response.data);

      // Extract links with better handling of relative URLs
      const links: string[] = [];
      $("a").each((_, element) => {
        const href = $(element).attr("href");
        if (href) {
          // Skip anchor links and javascript: URLs
          if (href.startsWith("#") || href.startsWith("javascript:")) {
            return;
          }

          try {
            // Handle relative URLs
            let fullUrl: string;
            if (href.startsWith("/")) {
              // Absolute path
              fullUrl = new URL(href, this.baseUrl).href;
            } else if (!href.includes("://")) {
              // Relative path
              const urlObj = new URL(url);
              const basePath = urlObj.pathname.endsWith("/")
                ? urlObj.pathname
                : urlObj.pathname.substring(
                    0,
                    urlObj.pathname.lastIndexOf("/") + 1
                  );
              fullUrl = new URL(href, `${urlObj.origin}${basePath}`).href;
            } else {
              // Already absolute URL
              fullUrl = href;
            }

            // Only include URLs from the same domain
            if (fullUrl.startsWith(this.baseUrl.origin)) {
              links.push(fullUrl);
            }
          } catch (error) {
            logger.error("Crawler", `Failed to parse URL ${href}: ${error}`);
          }
        }
      });

      // Wait for client-side content to fully load
      // Use a longer timeout to ensure dynamic content has loaded
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Additional waiting for any pending network requests or animations
      // This helps ensure the page is fully rendered
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Extract content - specifically target shadcn/ui docs structure
      const title = $("title").text().trim();

      // Remove script and style tags
      $("script, style").remove();

      // Extract content from common documentation elements
      let content = "";

      // Try to find the main content area
      const mainContent = $(
        "main, article, .content, .documentation, [role='main']"
      );

      if (mainContent.length > 0) {
        // Get headings
        mainContent.find("h1, h2, h3, h4, h5, h6").each((_, el) => {
          content += "\n" + $(el).text().trim() + "\n";
        });

        // Get paragraphs and text content
        mainContent.find("p, pre, code, .content, article").each((_, el) => {
          const text = $(el).text().trim();
          if (text) {
            content += text + "\n";
          }
        });

        // Get lists
        mainContent.find("ul, ol").each((_, el) => {
          $(el)
            .find("li")
            .each((_, li) => {
              const text = $(li).text().trim();
              if (text) {
                content += "• " + text + "\n";
              }
            });
        });

        content = content.trim();
      }

      // Fallback to body text if no main content found
      if (!content) {
        content = $("body").text().trim();
      }

      return {
        url,
        title,
        content,
        links,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Crawler", `Failed to process ${url}: ${errorMessage}`);
      this.job.errors.push(`Failed to process ${url}: ${errorMessage}`);
      return null;
    }
  }

  private async savePage(result: PageResult) {
    let filePath = "";
    try {
      const urlPath = new URL(result.url).pathname;
      const absoluteOutputDir = path.resolve(process.cwd(), this.job.outputDir);
      filePath = path.join(
        absoluteOutputDir,
        `${urlPath.replace(/\//g, "_") || "index"}.json`
      );

      // Save the page content
      await saveToFile(filePath, JSON.stringify(result, null, 2));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Storage", `Failed to save ${filePath}: ${errorMessage}`);
      this.job.errors.push(`Failed to save ${filePath}: ${errorMessage}`);
    }
  }

  async crawl(): Promise<void> {
    try {
      // Start with the base URL
      this.queue.add(async () => {
        const normalizedUrl = normalizeUrl(this.baseUrl.href, this.baseUrl);
        if (!this.visited.has(normalizedUrl)) {
          this.visited.add(normalizedUrl);
          const result = await this.processPage(normalizedUrl);
          if (result) {
            await this.savePage(result);
            this.job.pagesProcessed++;

            // Add new links to queue
            for (const link of result.links) {
              if (!this.visited.has(link)) {
                this.queue.add(async () => {
                  this.visited.add(link);
                  const pageResult = await this.processPage(link);
                  if (pageResult) {
                    await this.savePage(pageResult);
                    this.job.pagesProcessed++;
                  }
                });
              }
            }
          }
        }
      });

      // Wait for all tasks to complete
      await this.queue.onIdle();
      this.job.status = "completed";
      this.job.endTime = new Date();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Crawler", `Crawl failed: ${errorMessage}`);
      this.job.status = "failed";
      this.job.errors.push(`Crawl failed: ${errorMessage}`);
      this.job.endTime = new Date();
    }
  }
}
