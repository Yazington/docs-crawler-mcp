import puppeteer from "puppeteer";
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
  private browser: puppeteer.Browser | null = null;

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

  private async initBrowser() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({ headless: true });
    }
  }

  private async processPage(url: string): Promise<PageResult | null> {
    logger.info("Crawler", `Processing page: ${url}`);
    try {
      await this.initBrowser();
      const page = await this.browser!.newPage();
      await page.goto(url, { waitUntil: "networkidle0" });

      // Extract links with better handling of relative URLs
      const links = await page.evaluate((baseUrl) => {
        const anchors = Array.from(document.querySelectorAll("a"));
        return anchors
          .map((a) => {
            const href = a.getAttribute("href");
            if (
              !href ||
              href.startsWith("#") ||
              href.startsWith("javascript:")
            ) {
              return null;
            }
            try {
              let fullUrl: string;
              if (href.startsWith("/")) {
                fullUrl = new URL(href, baseUrl).href;
              } else if (!href.includes("://")) {
                const basePath = window.location.pathname.endsWith("/")
                  ? window.location.pathname
                  : window.location.pathname.substring(
                      0,
                      window.location.pathname.lastIndexOf("/") + 1
                    );
                fullUrl = new URL(href, `${window.location.origin}${basePath}`)
                  .href;
              } else {
                fullUrl = href;
              }
              return fullUrl.startsWith(baseUrl) ? fullUrl : null;
            } catch (error) {
              console.error(`Failed to parse URL ${href}: ${error}`);
              return null;
            }
          })
          .filter((url): url is string => url !== null);
      }, this.baseUrl.origin);

      // Extract title
      const title = await page.title();

      // Extract content
      const content = await page.evaluate(() => {
        // Remove script and style tags
        document.querySelectorAll("script, style").forEach((el) => el.remove());

        const mainContent = document.querySelector(
          "main, article, .content, .documentation, [role='main']"
        );
        let content = "";

        if (mainContent) {
          // Get headings
          mainContent
            .querySelectorAll("h1, h2, h3, h4, h5, h6")
            .forEach((el) => {
              content += "\n" + el.textContent?.trim() + "\n";
            });

          // Get paragraphs and text content
          mainContent
            .querySelectorAll("p, pre, code, .content, article")
            .forEach((el) => {
              const text = el.textContent?.trim();
              if (text) {
                content += text + "\n";
              }
            });

          // Get lists
          mainContent.querySelectorAll("ul, ol").forEach((el) => {
            el.querySelectorAll("li").forEach((li) => {
              const text = li.textContent?.trim();
              if (text) {
                content += "• " + text + "\n";
              }
            });
          });

          content = content.trim();
        }

        // Fallback to body text if no main content found
        if (!content) {
          content = document.body.textContent?.trim() || "";
        }

        return content;
      });

      await page.close();

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

      // Save the page content with proper JSON formatting
      await saveToFile(filePath, JSON.stringify(result, null, 2));
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Storage", `Failed to save ${filePath}: ${errorMessage}`);
      this.job.errors.push(`Failed to save ${filePath}: ${errorMessage}`);
    }
  }

  async crawl(): Promise<void> {
    const MAX_DEPTH = 2;
    const processUrl = async (url: string, depth: number): Promise<void> => {
      const normalizedUrl = normalizeUrl(url, this.baseUrl);
      if (this.visited.has(normalizedUrl)) return;
      this.visited.add(normalizedUrl);

      try {
        const result = await this.processPage(normalizedUrl);
        if (result) {
          await this.savePage(result);
          this.job.pagesProcessed++;
          if (depth < MAX_DEPTH) {
            for (const link of result.links) {
              if (!this.visited.has(link)) {
                this.queue.add(async () => {
                  await processUrl(link, depth + 1);
                });
              }
            }
          }
        }
        // Even if result is null (page failed to load), we continue crawling
      } catch (error) {
        // Log the error but continue crawling
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(
          "Crawler",
          `Error processing ${normalizedUrl}: ${errorMessage}`
        );
        this.job.errors.push(
          `Error processing ${normalizedUrl}: ${errorMessage}`
        );
      }
    };

    this.queue.add(async () => {
      await processUrl(this.baseUrl.href, 0);
    });

    try {
      await this.queue.onIdle();
      // Only mark as failed if no pages were processed at all
      if (this.job.pagesProcessed === 0) {
        this.job.status = "failed";
        if (this.job.errors.length === 0) {
          this.job.errors.push(
            "Crawl failed: No pages were processed successfully"
          );
        }
      } else {
        this.job.status = "completed";
      }
      this.job.endTime = new Date();
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error("Crawler", `Fatal crawl error: ${errorMessage}`);
      this.job.status = "failed";
      this.job.errors.push(`Fatal crawl error: ${errorMessage}`);
      this.job.endTime = new Date();
    }
  }
}
