export default [
  {
    name: "Get online documentation",
    description: "Get documentation about any library/tool/framework/etc.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to crawl",
        },
        waitForSelector: {
          type: "string",
          description: "Optional CSS selector to wait for before scraping",
        },
        queries: {
          type: "array",
          description:
            "List of search queries you want to search for. Make sure they are all different and pick at least 3!",
          items: { type: "string" },
        },
      },
      required: ["url"],
    },
  },
  {
    name: "Search documentation",
    description:
      "Search previously crawled documentation without crawling. If not enough info, crawl more",
    inputSchema: {
      type: "object",
      properties: {
        queries: {
          type: "array",
          description:
            "List of search queries you want to search for. Make sure they are all different and pick at least 3!",
          items: { type: "string" },
        },
      },
      required: ["queries"],
    },
  },
];
