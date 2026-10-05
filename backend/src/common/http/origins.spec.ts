import { allowedOrigins, clientIp, isOriginAllowed, trustProxySetting } from './origins.js';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe('isOriginAllowed', () => {
  it('lets non browser clients through', () => {
    expect(isOriginAllowed(undefined)).toBe(true);
  });

  it('accepts every configured origin, with or without a trailing slash', () => {
    process.env.FRONTEND_ORIGIN = 'https://rothenhall.com, https://www.rothenhall.com/';
    expect(allowedOrigins()).toEqual([
      'https://rothenhall.com',
      'https://www.rothenhall.com',
    ]);
    expect(isOriginAllowed('https://www.rothenhall.com')).toBe(true);
    expect(isOriginAllowed('https://evil.example')).toBe(false);
  });

  it('allows any localhost port in development only', () => {
    process.env.FRONTEND_ORIGIN = 'https://rothenhall.com';
    process.env.NODE_ENV = 'development';
    expect(isOriginAllowed('http://localhost:3100')).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(isOriginAllowed('http://localhost:3100')).toBe(false);
  });
});

describe('clientIp', () => {
  const request = (forwarded?: string) =>
    ({
      headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
      socket: { remoteAddress: '10.0.0.1' },
    }) as never;

  it('uses the socket address by default, ignoring a spoofable header', () => {
    expect(clientIp(request('1.2.3.4'))).toBe('10.0.0.1');
  });

  it('uses the first forwarded address once the proxy is trusted', () => {
    process.env.TRUST_PROXY = 'true';
    expect(clientIp(request('1.2.3.4, 10.0.0.9'))).toBe('1.2.3.4');
  });
});

describe('trustProxySetting', () => {
  it.each([
    [undefined, false],
    ['false', false],
    ['true', true],
    ['2', 2],
  ])('%s -> %s', (value, expected) => {
    if (value === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = value;
    expect(trustProxySetting()).toBe(expected);
  });
});
