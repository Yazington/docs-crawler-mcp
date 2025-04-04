/**
 * Puppeteer-based web crawler module.
 *
 * This module provides functions to:
 * - Launch a headless browser instance
 * - Navigate to URLs and wait for specific elements
 * - Extract and convert page content to Markdown, filtering unwanted elements
 * - Extract all internal links from a page
 * - Recursively crawl discovered URLs with configurable depth and page limits
 * - Save crawled content to disk
 *
 * It is designed to crawl documentation websites or similar content-rich sites,
 * converting relevant HTML content into Markdown format for further processing.
 */

import puppeteer from "puppeteer";
import TurndownService from "turndown";

import { Browser } from "puppeteer";

/**
 * Launches a new headless Puppeteer browser instance with sandbox disabled.
 *
 * @returns {Promise<Browser>} A Promise resolving to the launched Browser instance.
 */
export async function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

/**
 * Navigates the given Puppeteer page to the specified URL.
 * Optionally waits for a CSS selector to appear before proceeding.
 *
 * @param {puppeteer.Page} page - The Puppeteer page instance to navigate.
 * @param {string} url - The URL to navigate to.
 * @param {string} [waitForSelector] - Optional CSS selector to wait for after navigation.
 * @returns {Promise<void>} Resolves when navigation (and optional wait) completes.
 * @throws Will throw if navigation or waiting times out or fails.
 */
export async function navigateAndWait(
  page: puppeteer.Page,
  url: string,
  waitForSelector?: string
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

  if (waitForSelector && typeof waitForSelector === "string") {
    await page.waitForSelector(waitForSelector, { timeout: 15000 });
  }
}

/**
 * Extracts the main content of the page, filters out unwanted elements,
 * and converts the remaining HTML into Markdown format.
 *
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @returns {Promise<string>} The extracted content converted to Markdown.
 */
export async function extractMarkdown(page: puppeteer.Page): Promise<string> {
  const filteredContent = await filterUnwantedElements(page);
  const turndownService = new TurndownService();
  return turndownService.turndown(filteredContent);
}

/**
 * Internal helper that filters out unwanted elements from the page DOM,
 * such as navigation bars, ads, footers, and scripts.
 * Returns a string of concatenated HTML of relevant content elements.
 *
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @returns {Promise<string>} Filtered HTML content as a string.
 */
async function filterUnwantedElements(page: puppeteer.Page): Promise<string> {
  return await page.evaluate(() => {
    // Remove all <script>, <style>, <noscript> tags
    document
      .querySelectorAll("script, style, noscript")
      .forEach((el) => el.remove());

    // Remove unwanted UI/navigation elements
    const unwantedSelectors = [
      "nav",
      "footer",
      "aside",
      ".navbar",
      ".sidebar",
      ".menu",
      ".search",
      ".breadcrumb",
      ".toc",
      ".ad",
      ".banner",
      ".toolbar",
      ".btn",
      ".button",
      ".pagination",
      ".header",
      ".top-nav",
      ".side-nav",
      ".skip-link",
      ".skip-to-content",
      ".logo",
      ".brand",
      ".copyright",
      ".legal",
      ".cookie",
      ".consent",
      ".newsletter",
      ".subscribe",
      ".share",
      ".related",
      ".comments",
      ".comment",
      ".disclaimer",
      ".note",
      ".alert",
      ".warning",
      ".info",
      ".notification",
      ".promo",
      ".announcement",
      ".social",
    ];
    unwantedSelectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => el.remove());
    });

    // Whitelist content elements
    const contentElements = document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, p, pre, code, article, section, table"
    );
    return Array.from(contentElements)
      .map((el) => el.outerHTML)
      .join("\n");
  });
}

/**
 * Extracts all unique HTTP(S) URLs on the page that belong to the same origin as the provided base URL.
 *
 * This includes:
 * - All relative links (resolved against the base URL)
 * - All absolute links with the same origin (protocol + hostname + port)
 *
 * The function:
 * - Deduplicates URLs (returns unique entries only)
 * - Excludes links with non-http(s) protocols (e.g., mailto:, tel:, javascript:)
 * - Skips empty, whitespace-only, or malformed hrefs
 *
 * @param {string} url - The base URL to resolve relative links and compare origins.
 * @param {puppeteer.Page} page - The Puppeteer page instance.
 * @returns {Promise<string[]>} Promise resolving to an array of absolute URLs as strings.
 */
export async function extractAllUrlsWithSameBaseUrl(
  url: string,
  page: puppeteer.Page
): Promise<string[]> {
  const baseOrigin = new URL(url).origin;

  const links = await page.evaluate(() => {
    const anchorElements = Array.from(document.querySelectorAll("a[href]"));
    return anchorElements.map(
      (a) => (a as HTMLAnchorElement).getAttribute("href") || ""
    );
  });

  const uniqueUrls = new Set<string>();

  for (const href of links) {
    const trimmedHref = href.trim();
    if (!trimmedHref) continue; // skip empty hrefs

    let resolvedUrl: URL;
    try {
      resolvedUrl = new URL(trimmedHref, url);
    } catch {
      continue; // skip invalid URLs
    }

    if (
      (resolvedUrl.protocol === "http:" || resolvedUrl.protocol === "https:") &&
      resolvedUrl.origin === baseOrigin
    ) {
      uniqueUrls.add(resolvedUrl.toString());
    }
  }

  return Array.from(uniqueUrls);
}
