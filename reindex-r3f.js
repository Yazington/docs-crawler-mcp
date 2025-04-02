// Script to force reindexing of R3F documentation
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';
import { IndexDatabase } from './build/index-db.js';

// ES modules fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log('Starting manual reindex of R3F documentation...');

    const websiteDir = path.join(
        os.homedir(),
        'Documents',
        'MCP',
        'docs-crawler-data',
        'websites',
        'r3f_docs_pmnd_rs_95484f89'
    );

    const indexDir = path.join(
        os.homedir(),
        'Documents',
        'MCP',
        'docs-crawler-data',
        'index'
    );

    console.log(`Website directory: ${websiteDir}`);
    console.log(`Index directory: ${indexDir}`);

    // Get database instance with the custom index directory
    const db = await IndexDatabase.getInstance(indexDir);

    // Manually index the documents
    console.log(`Indexing documents from ${websiteDir}...`);
    const count = await db.indexDocuments(websiteDir);

    console.log(`Successfully indexed ${count} documents.`);
}

main().catch(console.error);
