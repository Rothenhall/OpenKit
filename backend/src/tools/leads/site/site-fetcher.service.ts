import { BadRequestException, Injectable } from '@nestjs/common';
import {
  discoverSitemap,
  rankCandidates,
} from './discovery.js';
import { isAllowedByRobots, parseHtml } from './html.js';
import { assertPublicUrl } from './url-guard.js';

export interface SitePage {
  url: string;
  title: string;
  description: string;
  text: string;
}

const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const EXTRA_PAGES = 6;
const MAX_CHARS_PER_PAGE = 4000;
const USER_AGENT = 'RothenhallOpenkitBot/1.0 (+https://rothenhall.com)';

@Injectable()
export class SiteFetcherService {
  /**
   * Reads the home page plus the marketing pages most likely to describe
   * the offer. Sitemap discovery and the home page fetch run in parallel,
   * then the ranked pool is fetched in parallel. One slow page never
   * stops the rest.
   */
  async fetchSite(input: string): Promise<SitePage[]> {
    const start = await assertPublicUrl(input);
    const robots = await this.fetchText(new URL('/robots.txt', start)).catch(
      () => '',
    );

    if (!isAllowedByRobots(robots, start.pathname)) {
      throw new BadRequestException('That website asks bots not to read it');
    }

    const fetchXml = (url: string) => this.fetchText(new URL(url));
    const [sitemapLinks, homeHtml] = await Promise.all([
      discoverSitemap(fetchXml, robots, start).catch(() => [] as string[]),
      this.fetchText(start),
    ]);
    const home = parseHtml(homeHtml, start);
    const pages: SitePage[] = [this.toPage(start.toString(), home)];

    const pool = [...new Set([...sitemapLinks, ...home.links])].filter(
      (link) => {
        try {
          return isAllowedByRobots(robots, new URL(link).pathname);
        } catch {
          return false;
        }
      },
    );
    const extras = rankCandidates(
      pool.filter((link) => link !== pages[0].url),
      EXTRA_PAGES,
    );
    const results = await Promise.allSettled(
      extras.map(async (link) => {
        const page = parseHtml(
          await this.fetchText(new URL(link)),
          new URL(link),
        );
        return this.toPage(link, page);
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.text.length > 200) {
        pages.push(result.value);
      }
    }

    if (pages[0].text.length < 100 && pages.length === 1) {
      throw new BadRequestException(
        'We could not read text from that website. It may need JavaScript to load.',
      );
    }
    return pages;
  }

  private toPage(
    url: string,
    parsed: { title: string; description: string; text: string },
  ): SitePage {
    return {
      url,
      title: parsed.title,
      description: parsed.description,
      text: parsed.text.slice(0, MAX_CHARS_PER_PAGE),
    };
  }

  /** GET with a timeout, a size cap, and a public address check on every redirect. */
  private async fetchText(start: URL): Promise<string> {
    let url = await assertPublicUrl(start.toString());
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain' },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await this.readCapped(response);
    }
    throw new Error('Too many redirects');
  }

  private async readCapped(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    while (bytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
    await reader.cancel().catch(() => undefined);
    return text;
  }
}
