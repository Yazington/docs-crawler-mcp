// Debug script for troubleshooting R3F docs crawler search issues
import { fileURLToPath } from 'url';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { IndexDatabase } from './build/index-db.js';

// ES modules fix for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log('Starting debug search for R3F docs');

    const indexDir = path.join(
        os.homedir(),
        'Documents',
        'MCP',
        'docs-crawler-data',
        'index'
    );

    const websiteDir = path.join(
        os.homedir(),
        'Documents',
        'MCP',
        'docs-crawler-data',
        'websites',
        'r3f_docs_pmnd_rs_95484f89'
    );

    console.log(`Website directory: ${websiteDir}`);
    console.log(`Index directory: ${indexDir}`);

    // Check if directories exist
    console.log(`Website directory exists: ${fs.existsSync(websiteDir)}`);
    console.log(`Index directory exists: ${fs.existsSync(indexDir)}`);

    // Check for JSON files in website directory
    const websiteFiles = fs.readdirSync(websiteDir).filter(file => file.endsWith('.json'));
    console.log(`Found ${websiteFiles.length} JSON files in website directory`);

    // Check for index files
    const indexFiles = fs.readdirSync(indexDir).filter(file => file.endsWith('.index.json'));
    console.log(`Found ${indexFiles.length} index files total`);

    // Check for R3F specific index files
    const r3fIndexFiles = indexFiles.filter(file =>
        file.includes('_getting-started_') ||
        file.includes('_api_') ||
        file.includes('_tutorials_') ||
        file.includes('_advanced_')
    );
    console.log(`Found ${r3fIndexFiles.length} R3F-related index files`);
    r3fIndexFiles.forEach(file => console.log(`  - ${file}`));

    // Initialize database
    const db = await IndexDatabase.getInstance(indexDir);

    // Perform a search with a specific query that should match R3F content
    const targetUrl = "https://r3f.docs.pmnd.rs";
    console.log(`\nPerforming search for "react three fiber" with base URL ${targetUrl}`);
    const results = await db.search("react three fiber", 10, targetUrl);

    console.log(`Search returned ${results.length} results`);

    if (results.length > 0) {
        results.forEach((result, i) => {
            console.log(`\nResult ${i + 1}:`);
            console.log(`URL: ${result.url}`);
            console.log(`Title: ${result.title}`);
            console.log(`Distance: ${result.distance}`);
            console.log(`Content preview: ${result.content.substring(0, 100)}...`);
        });
    } else {
        console.log("No results found. Trying without URL filter...");

        // Try without URL filter
        const allResults = await db.search("react three fiber", 10);
        console.log(`Search without URL filter returned ${allResults.length} results`);

        if (allResults.length > 0) {
            allResults.forEach((result, i) => {
                console.log(`\nResult ${i + 1}:`);
                console.log(`URL: ${result.url}`);
                console.log(`Title: ${result.title}`);
                console.log(`Distance: ${result.distance}`);
                console.log(`Content preview: ${result.content.substring(0, 100)}...`);
            });

            // Check if any results contain R3F URL but weren't being filtered correctly
            const r3fResults = allResults.filter(r => r.url.includes("r3f.docs.pmnd.rs"));
            console.log(`\nFound ${r3fResults.length} results with R3F URL that weren't filtered correctly`);
        }
    }
}

main().catch(console.error);
