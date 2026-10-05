/** Sitemap discovery plus cheap deterministic page ranking. */

const MAX_SITEMAP_FILES = 3;
const MAX_SITEMAP_URLS = 200;

/** Path weights. Positive pages describe the business, negative ones are noise. */
const WEIGHTS: [RegExp, number][] = [
  [/pricing|plans|price/i, 5],
  [/products?|services?|solutions?|platform|features?/i, 5],
  [/case-stud|customer|clients|use-case|testimonial/i, 4],
  [/industr|integration/i, 3],
  [/about|compan|team|who-we-are|faq|questions/i, 2],
  [/contact|demo|trial/i, 1],
  [/career|jobs|hiring/i, 0],
  [/blog|news|press|changelog/i, -1],
  [/legal|privacy|terms|cookie|login|sign-?in|sign-?up|cart|checkout/i, -3],
];

export function scoreUrl(link: string): number {
  let path = '';
  try {
    path = new URL(link).pathname;
  } catch {
    return -3;
  }
  let score = 0;
  let matched = false;
  for (const [re, w] of WEIGHTS) {
    if (re.test(path)) {
      matched = true;
      score = Math.max(score, w);
      if (w < 0) score = Math.min(score, w);
    }
  }
  if (!matched) score = 0;
  return score;
}

function isJunk(link: string): boolean {
  return scoreUrl(link) < 0;
}

/**
 * Ranks candidate page URLs. Positive pages first, shallow paths before
 * deep ones. Backfills with neutral shallow pages when positives run out.
 */
export function rankCandidates(links: string[], limit: number): string[] {
  const seen = new Set<string>();
  const ranked = links
    .filter((link) => {
      if (seen.has(link)) return false;
      seen.add(link);
      return true;
    })
    .map((link) => {
      let depth = 9;
      try {
        depth = new URL(link).pathname.split('/').filter(Boolean).length;
      } catch {
        // keep depth high so bad URLs sort last
      }
      return { link, score: scoreUrl(link), depth };
    })
    .filter((l) => !isJunk(l.link) && l.depth <= 3)
    .sort((a, b) => b.score - a.score || a.depth - b.depth);
  const positive = ranked.filter((l) => l.score > 0).slice(0, limit);
  if (positive.length >= limit) return positive.map((l) => l.link);
  const filler = ranked
    .filter((l) => l.score === 0 && !positive.includes(l))
    .slice(0, limit - positive.length);
  return [...positive, ...filler].map((l) => l.link);
}

/** Pulls `<loc>` URLs from a sitemap or sitemap index, same host only. */
export function sitemapUrls(xml: string, base: URL): string[] {
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    try {
      const link = new URL(match[1], base);
      if (link.host === base.host && /^https?:$/.test(link.protocol)) {
        link.hash = '';
        urls.push(link.toString());
      }
    } catch {
      // ignore malformed entries
    }
    if (urls.length >= MAX_SITEMAP_URLS) break;
  }
  return [...new Set(urls)];
}

export function sitemapDeclarations(robots: string): string[] {
  const urls: string[] = [];
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    const [field, ...rest] = line.split(':');
    if (field.trim().toLowerCase() === 'sitemap') {
      const value = rest.join(':').trim();
      if (value) urls.push(value);
    }
  }
  return urls;
}

/**
 * Collects candidate URLs from robots Sitemap lines plus /sitemap.xml,
 * following one level of sitemap index. Bounded and fail soft.
 */
export async function discoverSitemap(
  fetchXml: (url: string) => Promise<string>,
  robots: string,
  base: URL,
): Promise<string[]> {
  const files = [
    ...sitemapDeclarations(robots),
    new URL('/sitemap.xml', base).toString(),
  ].slice(0, MAX_SITEMAP_FILES);
  const found: string[] = [];
  for (const file of files) {
    let xml = '';
    try {
      xml = await fetchXml(file);
    } catch {
      continue;
    }
    const locs = sitemapUrls(xml, base);
    if (/<sitemapindex/i.test(xml)) {
      for (const nested of locs.slice(0, MAX_SITEMAP_FILES)) {
        if (!/\.(xml)(\?|$)/i.test(nested)) continue;
        try {
          found.push(...sitemapUrls(await fetchXml(nested), base));
        } catch {
          // skip unreadable nested sitemaps
        }
      }
    } else {
      found.push(...locs);
    }
  }
  return [...new Set(found)].slice(0, MAX_SITEMAP_URLS);
}
