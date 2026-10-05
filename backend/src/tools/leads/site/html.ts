const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decode(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function meta(html: string, key: string): string {
  const tag = html.match(
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i'),
  )?.[0];
  const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
  return content ? decode(content).trim() : '';
}

export interface ParsedPage {
  title: string;
  description: string;
  text: string;
  links: string[];
}

export function parseHtml(html: string, baseUrl: URL): ParsedPage {
  const title = decode(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '',
  ).trim();
  const description = meta(html, 'description') || meta(html, 'og:description');

  const links: string[] = [];
  for (const match of html.matchAll(/<a\s[^>]*href=["']([^"'#][^"']*)["']/gi)) {
    try {
      const link = new URL(match[1], baseUrl);
      if (link.host === baseUrl.host && /^https?:$/.test(link.protocol)) {
        link.hash = '';
        links.push(link.toString());
      }
    } catch {
      // ignore malformed hrefs
    }
  }

  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|section|tr|br)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

  return { title, description, text, links: [...new Set(links)] };
}

const PAGE_HINTS: [RegExp, number][] = [
  [/pricing|plans|price/i, 5],
  [/product|solution|service|platform|feature/i, 4],
  [/about|company|who-we-are/i, 3],
  [/customer|case-stud|clients|work/i, 3],
  [/contact/i, 1],
];

/** Picks the links most likely to describe what the company sells. */
export function pickUsefulLinks(links: string[], limit: number): string[] {
  return links
    .map((link) => {
      const path = new URL(link).pathname;
      const score = PAGE_HINTS.reduce(
        (s, [re, w]) => (re.test(path) ? Math.max(s, w) : s),
        0,
      );
      return { link, score, depth: path.split('/').filter(Boolean).length };
    })
    .filter((l) => l.score > 0 && l.depth <= 2)
    .sort((a, b) => b.score - a.score || a.depth - b.depth)
    .slice(0, limit)
    .map((l) => l.link);
}

/** Checks the `User-agent: *` group of a robots.txt for a blocking Disallow rule. */
export function isAllowedByRobots(robots: string, path: string): boolean {
  let applies = false;
  let allowed = true;
  let longest = -1;
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0].trim();
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    const key = field.trim().toLowerCase();
    if (key === 'user-agent') applies = value === '*';
    else if (
      applies &&
      (key === 'disallow' || key === 'allow') &&
      value &&
      path.startsWith(value)
    ) {
      if (value.length > longest) {
        longest = value.length;
        allowed = key === 'allow';
      }
    }
  }
  return allowed;
}
