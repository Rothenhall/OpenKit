/**
 * Speech to text mishears unfamiliar company and product names, for example
 * "Roth and Hall" or "Rothon Hall" for Rothenhall. The call knows which names
 * matter, so a transcript word run that sounds almost exactly like one of
 * them is corrected to the real spelling. Deliberately conservative: only
 * distinctive names (six letters or more) and only close matches.
 */
const MIN_TERM_LENGTH = 6;
const MIN_SIMILARITY = 0.8;

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const current = [i];
    for (let j = 1; j < cols; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return 1 - previous[cols - 1] / Math.max(a.length, b.length);
}

/** Distinctive single words from the company name and capitalised offering words. */
export function brandTerms(name: string, offerings: string[]): string[] {
  const words = [
    ...(name.match(/[\p{L}\p{N}]+/gu) ?? []),
    ...offerings.flatMap((o) => o.match(/\b[A-Z][\p{L}\p{N}]+/gu) ?? []),
  ];
  return [...new Set(words.filter((w) => w.length >= MIN_TERM_LENGTH))];
}

export function correctBrandNames(text: string, terms: string[]): string {
  if (!terms.length || !text) return text;
  const tokens = text.split(/(\s+)/); // keeps the whitespace so spacing survives
  const wordIdx = tokens.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0);
  const clean = (t: string) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  let result = [...tokens];
  for (const term of terms) {
    const target = term.toLowerCase();
    for (let span = 1; span <= 3; span++) {
      for (let w = 0; w + span <= wordIdx.length; w++) {
        const first = wordIdx[w];
        const last = wordIdx[w + span - 1];
        const words = wordIdx.slice(w, w + span).map((i) => result[i]);
        // Brand names are written in Latin letters. Never touch Indic words.
        if (words.some((x) => x === undefined || !/^[A-Za-z0-9'"“”‘’.,!?;:()-]+$/.test(x))) continue;
        const joined = words.map(clean).join('').toLowerCase();
        if (!joined || joined === target) continue;
        // The name is already in this run. Do not swallow its neighbours.
        if (words.some((x) => clean(x).toLowerCase() === target)) continue;
        if (Math.abs(joined.length - target.length) > 3) continue;
        if (similarity(joined, target) < MIN_SIMILARITY) continue;
        // Keep punctuation hugging the run, replace only the words.
        const lead = result[first].match(/^[^\p{L}\p{N}]*/u)?.[0] ?? '';
        const tail = result[last].match(/[^\p{L}\p{N}]*$/u)?.[0] ?? '';
        result = [
          ...result.slice(0, first),
          `${lead}${term}${tail}`,
          ...result.slice(last + 1),
        ];
        // Indexes shifted. Rebuild them for the next pass.
        const rebuilt = result.map((t, i) => (/\S/.test(t) ? i : -1)).filter((i) => i >= 0);
        wordIdx.length = 0;
        wordIdx.push(...rebuilt);
        w = -1;
        span = 1;
      }
    }
  }
  return result.join('');
}
