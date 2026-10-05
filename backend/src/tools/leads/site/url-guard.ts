import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';

/** True for loopback, private, link-local and other non public addresses. */
export function isPrivateAddress(address: string): boolean {
  const mapped = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(mapped) === 4) {
    const [a, b] = mapped.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  return (
    mapped === '::' ||
    mapped === '::1' ||
    mapped.startsWith('fc') ||
    mapped.startsWith('fd') ||
    mapped.startsWith('fe8') ||
    mapped.startsWith('fe9') ||
    mapped.startsWith('fea') ||
    mapped.startsWith('feb')
  );
}

/** Adds https:// when missing and rejects anything that is not a public http(s) site. */
export async function assertPublicUrl(input: string): Promise<URL> {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input)
    ? input
    : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new BadRequestException('That does not look like a website address');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException(
      'Only http and https addresses are supported',
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new BadRequestException('That address is not a public website');
  }
  const addresses = isIP(host) ? [{ address: host }] : await lookupAll(host);
  if (
    addresses.length === 0 ||
    addresses.some((a) => isPrivateAddress(a.address))
  ) {
    throw new BadRequestException('That address is not a public website');
  }
  return url;
}

async function lookupAll(host: string): Promise<{ address: string }[]> {
  try {
    return await lookup(host, { all: true });
  } catch {
    throw new BadRequestException('We could not find that website');
  }
}
