import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./utils.js";
import {
  handleSearchWebsite,
  handleListCrawledWebsites,
  handleRecrawlWebsite,
  handleSearchExistingData,
} from "./tools.js";

// Create MCP server
const server = new Server(
  {
    name: "docs-crawler-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_website",
        description:
          "Crawl, index and search a documentation website with multiple diverse queries - all in one operation",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Base URL of the documentation website",
            },
            queries: {
              type: "array",
              items: {
                type: "string",
              },
              description:
                "List of diverse search queries covering different aspects (implementation, usage, configuration, examples, etc.)",
              minItems: 3,
              maxItems: 10,
            },
            limit: {
              type: "number",
              description:
                "Maximum number of results to return per query (default: 5)",
            },
            forceCrawl: {
              type: "boolean",
              description:
                "Force recrawling of the website even if it has been crawled before (default: false)",
            },
          },
          required: ["url", "queries"],
        },
      },
      {
        name: "list_crawled_websites",
        description:
          "List all websites that have been crawled and are available for searching",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "recrawl_website",
        description:
          "Force recrawl a previously crawled website to update its content",
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL of the website to recrawl",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "search_existing_data",
        description:
          "Search directly in existing crawled data without crawling a new website",
        inputSchema: {
          type: "object",
          properties: {
            queries: {
              type: "array",
              items: {
                type: "string",
              },
              description: "Search queries to find in existing data",
              minItems: 1,
              maxItems: 10,
            },
            url: {
              type: "string",
              description: "Optional: limit search to a specific website URL",
            },
            limit: {
              type: "number",
              description: "Maximum number of results to return (default: 5)",
            },
          },
          required: ["queries"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    if (request.params.name === "search_website") {
      const results = await handleSearchWebsite(
        request.params.arguments as {
          url: string;
          queries: string[];
          limit?: number;
          forceCrawl?: boolean;
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } else if (request.params.name === "list_crawled_websites") {
      const websites = await handleListCrawledWebsites();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(websites, null, 2),
          },
        ],
      };
    } else if (request.params.name === "recrawl_website") {
      const result = await handleRecrawlWebsite(
        request.params.arguments as { url: string }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } else if (request.params.name === "search_existing_data") {
      const results = await handleSearchExistingData(
        request.params.arguments as {
          queries: string[];
          url?: string;
          limit?: number;
        }
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    } else {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
    }
  } catch (error: unknown) {
    if (error instanceof McpError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new McpError(ErrorCode.InternalError, errorMessage);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("Server", "Documentation crawler MCP server running");
}

main().catch((error) => {
  logger.error("Fatal", error);
  process.exit(1);
});
