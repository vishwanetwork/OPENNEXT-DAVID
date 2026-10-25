import { z } from 'zod';
import { str } from '../_shared';

/** `GET /api/news` */
export const NewsArticle = z
  .object({ title: z.string(), url: str, source: str, publishedAt: str, date: str })
  .passthrough();
export type NewsArticle = z.infer<typeof NewsArticle>;
export const NewsResponse = z
  .object({
    status: z.string().default('unavailable'),
    fetchedAt: str,
    lastAttemptAt: str,
    stale: z.boolean().optional(),
    articles: z.array(NewsArticle).default([]),
  })
  .passthrough();
export type NewsResponse = z.infer<typeof NewsResponse>;
