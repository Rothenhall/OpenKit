import {
  discoverSitemap,
  rankCandidates,
  scoreUrl,
  sitemapDeclarations,
  sitemapUrls,
} from './discovery.js';
import { isAllowedByRobots, parseHtml, pickUsefulLinks } from './html.js';
import { assertPublicUrl, isPrivateAddress } from './url-guard.js';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '192.168.0.5',
    '172.20.0.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:10.0.0.1',
  ])('blocks %s', (address) => expect(isPrivateAddress(address)).toBe(true));
  it.each(['8.8.8.8', '172.32.0.1', '2606:4700::1111'])(
    'allows %s',
    (address) => expect(isPrivateAddress(address)).toBe(false),
  );
});

describe('assertPublicUrl', () => {
  it('rejects localhost, private IPs and other schemes', async () => {
    await expect(assertPublicUrl('http://localhost:3000')).rejects.toThrow();
    await expect(assertPublicUrl('http://192.168.1.1')).rejects.toThrow();
    await expect(assertPublicUrl('http://[::1]/')).rejects.toThrow();
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow();
  });
  it('adds https when the scheme is missing', async () => {
    const url = await assertPublicUrl('8.8.8.8');
    expect(url.protocol).toBe('https:');
  });
});

describe('parseHtml', () => {
  const base = new URL('https://acme.test/');
  const html = `<html><head><title>Acme &amp; Co</title>
    <meta name="description" content="We make anvils"><script>var x = 1;</script></head>
    <body><h1>Anvils</h1><p>Heavy &amp; durable.</p>
    <a href="/pricing">Pricing</a><a href="https://other.test/x">Out</a><a href="/about#team">About</a></body></html>`;

  it('extracts title, description and readable text without scripts', () => {
    const page = parseHtml(html, base);
    expect(page.title).toBe('Acme & Co');
    expect(page.description).toBe('We make anvils');
    expect(page.text).toContain('Heavy & durable.');
    expect(page.text).not.toContain('var x');
  });
  it('keeps only same host links', () => {
    expect(parseHtml(html, base).links).toEqual([
      'https://acme.test/pricing',
      'https://acme.test/about',
    ]);
  });
});

describe('pickUsefulLinks', () => {
  it('ranks pricing and product pages first and drops deep or irrelevant ones', () => {
    const picked = pickUsefulLinks(
      [
        'https://a.test/blog/2024/very/deep/post',
        'https://a.test/about',
        'https://a.test/pricing',
        'https://a.test/careers',
        'https://a.test/product',
      ],
      2,
    );
    expect(picked).toEqual([
      'https://a.test/pricing',
      'https://a.test/product',
    ]);
  });
});

describe('isAllowedByRobots', () => {
  const robots = 'User-agent: *\nDisallow: /private\nAllow: /private/open\n';
  it('applies the most specific rule', () => {
    expect(isAllowedByRobots(robots, '/')).toBe(true);
    expect(isAllowedByRobots(robots, '/private/x')).toBe(false);
    expect(isAllowedByRobots(robots, '/private/open/x')).toBe(true);
  });
  it('allows everything when there is no robots file', () => {
    expect(isAllowedByRobots('', '/anything')).toBe(true);
  });
});

describe('discovery', () => {
  it('scores marketing pages above junk', () => {
    expect(scoreUrl('https://a.test/pricing')).toBe(5);
    expect(scoreUrl('https://a.test/blog/post')).toBe(-1);
    expect(scoreUrl('https://a.test/privacy')).toBe(-3);
  });

  it('ranks positives first and drops junk and deep pages', () => {
    expect(
      rankCandidates(
        [
          'https://a.test/blog/post',
          'https://a.test/privacy',
          'https://a.test/a/b/c/d',
          'https://a.test/about',
          'https://a.test/pricing',
          'https://a.test/careers',
        ],
        3,
      ),
    ).toEqual([
      'https://a.test/pricing',
      'https://a.test/about',
      'https://a.test/careers',
    ]);
  });

  it('reads sitemap declarations and loc entries same host only', () => {
    expect(
      sitemapDeclarations('User-agent: *\nSitemap: https://a.test/s.xml\n'),
    ).toEqual(['https://a.test/s.xml']);
    const xml =
      '<urlset><url><loc>https://a.test/pricing</loc></url>' +
      '<url><loc>https://other.test/x</loc></url></urlset>';
    expect(sitemapUrls(xml, new URL('https://a.test'))).toEqual([
      'https://a.test/pricing',
    ]);
  });

  it('discovers sitemap and homepage candidates with bounds', async () => {
    const fetchXml = vi.fn(async (url: string) => {
      if (url.endsWith('/sitemap.xml')) {
        return '<sitemapindex><sitemap><loc>https://a.test/nested.xml</loc></sitemap></sitemapindex>';
      }
      if (url.endsWith('/nested.xml')) {
        return '<urlset><url><loc>https://a.test/product</loc></url></urlset>';
      }
      throw new Error('missing');
    });
    const found = await discoverSitemap(
      fetchXml,
      'User-agent: *\nSitemap: https://a.test/custom.xml\n',
      new URL('https://a.test'),
    );
    expect(found).toEqual(['https://a.test/product']);
    expect(fetchXml).toHaveBeenCalledTimes(3);
  });
});
