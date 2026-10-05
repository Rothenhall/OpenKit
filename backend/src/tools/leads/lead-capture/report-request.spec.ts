import { BadRequestException } from '@nestjs/common';
import { parseReportRequest } from '../dto/leads.dto.js';

describe('parseReportRequest', () => {
  it('needs only an email, and lowercases it', () => {
    expect(parseReportRequest({ email: ' Priya@Example.com ' })).toEqual({
      email: 'priya@example.com',
      phone: undefined,
      spam: false,
    });
  });

  it('keeps an optional phone number', () => {
    expect(
      parseReportRequest({ email: 'a@b.co', phone: '+91 98765 43210' }).phone,
    ).toBe('+91 98765 43210');
    expect(
      parseReportRequest({ email: 'a@b.co', phone: '  ' }).phone,
    ).toBeUndefined();
  });

  it.each(['', 'nope', 'a@b', 'a b@c.com', '@c.com'])(
    'rejects the email %j',
    (email) => {
      expect(() => parseReportRequest({ email })).toThrow(BadRequestException);
    },
  );

  it('rejects a junk phone number', () => {
    expect(() =>
      parseReportRequest({ email: 'a@b.co', phone: 'call me' }),
    ).toThrow(/phone/);
  });

  it('flags the hidden field as a bot and skips the rest', () => {
    expect(parseReportRequest({ website: 'http://spam.example' }).spam).toBe(
      true,
    );
  });

  it('asks for no name, role or consent box', () => {
    expect(() => parseReportRequest({ email: 'a@b.co' })).not.toThrow();
  });
});
