import { BadRequestException } from '@nestjs/common';
import { parseLead } from '../dto/leads.dto.js';

const valid = {
  name: ' Priya Nair ',
  email: 'Priya@Example.com',
  consent: true,
};

describe('parseLead', () => {
  it('trims, lowercases the email and keeps optional fields optional', () => {
    expect(parseLead(valid)).toEqual({
      name: 'Priya Nair',
      email: 'priya@example.com',
      phone: undefined,
      role: undefined,
      spam: false,
    });
  });

  it('keeps a valid phone and role', () => {
    const lead = parseLead({ ...valid, phone: '+91 98765 43210', role: 'VP Sales' });
    expect(lead.phone).toBe('+91 98765 43210');
    expect(lead.role).toBe('VP Sales');
  });

  it('requires consent', () => {
    expect(() => parseLead({ ...valid, consent: false })).toThrow(BadRequestException);
    expect(() => parseLead({ ...valid, consent: 'yes' })).toThrow(BadRequestException);
    expect(() => parseLead({ name: 'A', email: 'a@b.co' })).toThrow(/tick the box/);
  });

  it.each(['', 'nope', 'a@b', 'a b@c.com', '@c.com'])('rejects the email %j', (email) => {
    expect(() => parseLead({ ...valid, email })).toThrow(BadRequestException);
  });

  it('rejects a missing name and a junk phone', () => {
    expect(() => parseLead({ ...valid, name: '  ' })).toThrow(/name is required/);
    expect(() => parseLead({ ...valid, phone: 'call me' })).toThrow(/phone/);
  });

  it('flags the hidden honeypot field as spam without validating the rest', () => {
    expect(parseLead({ website: 'http://spam.example' }).spam).toBe(true);
  });

  it('limits field lengths', () => {
    const lead = parseLead({ ...valid, name: 'x'.repeat(500), role: 'y'.repeat(500) });
    expect(lead.name).toHaveLength(120);
    expect(lead.role).toHaveLength(120);
  });
});
