import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard',
          '/projects/',
          '/settings',
          '/ops/',
          '/auth/',
          '/api/',
          '/dev/',
          '/demo/status',
          '/monitoring',
          '/ingest/',
        ],
      },
      // AI search crawlers — allow indexing for AI-powered search
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      // AI training crawlers — block model training, not search
      { userAgent: 'GPTBot', disallow: '/' },
      { userAgent: 'CCBot', disallow: '/' },
      { userAgent: 'Google-Extended', disallow: '/' },
    ],
    sitemap: 'https://tabulate-ai.com/sitemap.xml',
  };
}
