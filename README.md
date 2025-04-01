# docs-crawler-mcp MCP Server

A powerful documentation website crawler and semantic search tool that helps you efficiently extract, index, and search through documentation content.

## Features

- **Intelligent Website Crawling**: Automatically crawls documentation websites while respecting site structure and rate limits
- **Smart Content Extraction**: Focuses on meaningful documentation content while filtering out navigation and boilerplate
- **Semantic Search**: Uses vector-based search to find relevant content even with different phrasing
- **Multi-Query Search**: Supports multiple diverse queries to get comprehensive results
- **Persistent Storage**: Caches crawled content for efficient reuse and quick searches
- **Deduplication**: Intelligently combines and ranks results from multiple queries

## Tools

### search_website

All-in-one tool to crawl a website and perform semantic searches:

```typescript
{
  "url": "https://docs.example.com",
  "queries": ["getting started", "configuration", "api reference"],
  "limit": 5,  // Optional: max results per query (default: 5)
  "forceCrawl": false  // Optional: force fresh crawl (default: false)
}
```

### list_crawled_websites

List all previously crawled websites with metadata:

```typescript
// No parameters required
// Returns array of:
{
  "url": "https://docs.example.com",
  "crawlDate": "2025-04-01T19:51:20.000Z",
  "pagesCount": 42
}
```

### recrawl_website

Force a fresh crawl of a previously indexed website:

```typescript
{
  "url": "https://docs.example.com"
}
```

### search_existing_data

Search through already crawled content without new crawling:

```typescript
{
  "queries": ["error handling", "authentication"],
  "url": "https://docs.example.com",  // Optional: limit to specific site
  "limit": 5  // Optional: max results (default: 5)
}
```

## Installation

To use with Claude Desktop, add the server config:

On Windows:

```json
// %APPDATA%/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "docs-crawler-mcp": {
      "command": "/path/to/docs-crawler-mcp/build/index.js"
    }
  }
}
```

On MacOS:

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "docs-crawler-mcp": {
      "command": "/path/to/docs-crawler-mcp/build/index.js"
    }
  }
}
```

## Development

Install dependencies:

```bash
npm install
```

Build the server:

```bash
npm run build
```

For development with auto-rebuild:

```bash
npm run watch
```

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. The MCP Inspector provides a web interface for monitoring server activity:

```bash
npm run inspector
```

This will provide a URL to access the debugging tools in your browser.

## Usage Examples

### Basic Website Search

```typescript
// Search a documentation site with multiple queries
const result = await server.callTool("search_website", {
  url: "https://docs.example.com",
  queries: [
    "getting started guide",
    "configuration options",
    "troubleshooting errors",
  ],
});
```

### Targeted Search in Existing Data

```typescript
// Search previously crawled content
const result = await server.callTool("search_existing_data", {
  queries: ["authentication", "oauth flow"],
  url: "https://api.example.com/docs", // Optional: limit to specific site
  limit: 10,
});
```

### Update Stale Documentation

```typescript
// Force a fresh crawl of a site
const result = await server.callTool("recrawl_website", {
  url: "https://docs.example.com",
});
```

### View Crawled Sites

```typescript
// List all crawled websites with metadata
const sites = await server.callTool("list_crawled_websites", {});
```
