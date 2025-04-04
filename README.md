# Quasar Crawler MCP Server

An MCP server that crawls documentation websites, converts them to Markdown, and stores embeddings in Qdrant for intelligent, up-to-date documentation search.

---

## Features

- **Crawl documentation sites** using Puppeteer
- **Convert HTML to Markdown** with jsdom and turndown
- **Generate embeddings** with Transformers
- **Store and search embeddings** in Qdrant vector database
- **Expose MCP resources and tools** for integration with other systems

---

## Installation

Clone the repository and install dependencies:

```bash
npm install
```

Build the project:

```bash
npm run build
```

---

## Usage

Configure this server as an MCP server (e.g., in Claude Desktop configuration):

```json
{
  "mcpServers": {
    "quasar-crawler": {
      "command": "/path/to/quasar-crawler/build/index.js"
    }
  }
}
```

Run the built server binary, then use the provided MCP tools and resources to crawl and query documentation content.

---

## Development

For active development with auto-rebuild:

```bash
npm run watch
```

Available scripts:

- `build` - Compile the TypeScript source
- `watch` - Rebuild on file changes
- `inspector` - Launch MCP Inspector for debugging

---

## Debugging

Use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to debug server communication:

```bash
npm run inspector
```

This will provide a URL to access debugging tools in your browser.

---

## Dependencies

- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/sdk)
- [@qdrant/js-client-rest](https://github.com/qdrant/qdrant-js)
- [@xenova/transformers](https://github.com/xenova/transformers.js)
- [puppeteer](https://pptr.dev/)
- [jsdom](https://github.com/jsdom/jsdom)
- [turndown](https://github.com/mixmark-io/turndown)
- [zod](https://github.com/colinhacks/zod)

---
