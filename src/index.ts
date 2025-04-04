import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import tools from "./tools.js";
import { z } from "zod";
import server from "./server.js";
import { crawlWebsite } from "./crawling.js";

const crawlUrlArgsSchema = z.object({
  url: z.string().url(),
  waitForSelector: z.string().optional(),
  queries: z.array(z.string()).optional(),
});

/**
 * List the available tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools,
  };
});

/**
 * Handle tool invocations
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "Get online documentation") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const { url, waitForSelector, queries } = crawlUrlArgsSchema.parse(
    request.params.arguments
  );

  return crawlWebsite(url, waitForSelector, queries);
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
