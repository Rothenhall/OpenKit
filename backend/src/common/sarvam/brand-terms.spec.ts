import { brandTerms, correctBrandNames } from './brand-terms.js';

describe('brandTerms', () => {
  it('keeps distinctive words from the name and capitalised offerings', () => {
    expect(brandTerms('Cailyx / Rothenhall', ['AI Visibility Score', 'audits'])).toEqual([
      'Cailyx',
      'Rothenhall',
      'Visibility',
    ]);
  });
});

describe('correctBrandNames', () => {
  const terms = ['Rothenhall', 'Cailyx'];

  it.each([
    ['this is Sam from Rothon Hall.', 'this is Sam from Rothenhall.'],
    ['Hi, I am calling from Roth and Hall today', 'Hi, I am calling from Rothenhall today'],
    ['We use Kailyx for this', 'We use Cailyx for this'],
    ['Rothenhall is fine already', 'Rothenhall is fine already'],
  ])('%s', (heard, fixed) => {
    expect(correctBrandNames(heard, terms)).toBe(fixed);
  });

  it('leaves ordinary words and unrelated text alone', () => {
    const text = 'Can we talk about the call on Friday at eleven?';
    expect(correctBrandNames(text, terms)).toBe(text);
    expect(correctBrandNames(text, [])).toBe(text);
  });

  it('works on Devanagari text with an English brand inside', () => {
    expect(correctBrandNames('मैं Rothon Hall से बोल रहा हूँ', terms)).toBe(
      'मैं Rothenhall से बोल रहा हूँ',
    );
  });
});
