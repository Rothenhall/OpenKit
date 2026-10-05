import { SpeechChunker } from './speech-chunker.js';

function run(pieces: string[]): string[] {
  const chunker = new SpeechChunker();
  return [...pieces.flatMap((p) => chunker.push(p)), ...chunker.flush()];
}

describe('SpeechChunker', () => {
  it('emits the first sentence as soon as the next word starts', () => {
    const chunker = new SpeechChunker();
    expect(chunker.push('Hello, this is Sam')).toEqual([]);
    expect(chunker.push(' from Acme. Do you')).toEqual(['Hello, this is Sam from Acme.']);
    expect(chunker.flush()).toEqual(['Do you']);
  });

  it('keeps decimals and abbreviations whole', () => {
    expect(run(['It costs 3.5 lakh. ', 'Fine.'])).toEqual([
      'It costs 3.5 lakh.',
      'Fine.',
    ]);
  });

  it('merges tiny later sentences instead of speaking choppy clips', () => {
    const out = run(['Sure, I can do that for you today. ', 'Okay. ', 'Right. ', 'Let us set a time for Friday at eleven.']);
    expect(out[0]).toBe('Sure, I can do that for you today.');
    expect(out[1]).toBe('Okay. Right. Let us set a time for Friday at eleven.');
  });

  it('splits Indic sentences on the danda', () => {
    expect(run(['नमस्ते, मैं राहुल बोल रहा हूँ। ', 'आप कैसे हैं?'])).toEqual([
      'नमस्ते, मैं राहुल बोल रहा हूँ।',
      'आप कैसे हैं?',
    ]);
  });

  it('lets the first chunk end at a comma once it is long enough', () => {
    const out = run(['Thanks for picking up the phone today, I know ', 'you are busy so I will keep this short. Okay?']);
    expect(out[0]).toBe('Thanks for picking up the phone today,');
  });

  it('never loses text', () => {
    const text = 'One thing at a time. Then another thing entirely, and a third, with no stop at the end';
    expect(run(text.match(/.{1,5}/g)!).join(' ')).toBe(text);
  });
});
