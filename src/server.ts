/**
 * MCP server that exposes a Puppeteer-based web crawler.
 * It provides a single tool "crawl_url" that fetches the HTML content of a given URL.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Create an MCP server with a single tool: crawl_url
 */
export default new Server(
  {
    name: "quasar-crawler",
    version: "0.2.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);
