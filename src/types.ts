import { URL } from "url";

export interface CrawlJob {
  id: string;
  baseUrl: string;
  status: "running" | "completed" | "failed";
  pagesProcessed: number;
  errors: string[];
  startTime: Date;
  endTime?: Date;
  outputDir: string;
}

export interface PageResult {
  url: string;
  title: string;
  content: string;
  links: string[];
}

export interface SearchResult {
  url: string;
  title: string;
  content: string;
  relevance: number;
  matchedQueries: string[];
}

// Map to store crawl jobs in memory
export const crawlJobs: Map<string, CrawlJob> = new Map();
