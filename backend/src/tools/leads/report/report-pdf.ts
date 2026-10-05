import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import type { Outcome, Scorecard, Turn } from '../leads.types.js';

export interface ReportData {
  company: string;
  site: string;
  scenarioTitle: string;
  buyerName: string;
  buyerRole?: string;
  /** `you-sell`: the visitor sold to an AI buyer. `ai-sells`: an AI caller sold to the visitor. */
  mode: 'you-sell' | 'ai-sells';
  difficulty: string;
  language: string;
  durationSeconds: number;
  turns: Turn[];
  scorecard: Scorecard;
  generatedAt: Date;
}

const COLOR = {
  ink: '#14110c',
  text: '#2b261f',
  muted: '#6b6458',
  copper: '#c67c48',
  canvas: '#f7f3ea',
  line: '#e2dac8',
  good: '#2f7d5b',
  warn: '#b3472f',
};

const OUTCOME_LABEL: Record<Outcome, string> = {
  next_step_agreed: 'Next step agreed',
  callback: 'Callback',
  declined: 'Declined',
  unclear: 'Unclear',
};

// Noto Sans, per script. Latin covers English, and each Indian script has its
// own file, so a Hindi or Tamil line prints as itself and not as boxes.
type Script =
  | 'latin'
  | 'devanagari'
  | 'bengali'
  | 'gujarati'
  | 'gurmukhi'
  | 'oriya'
  | 'tamil'
  | 'telugu'
  | 'kannada'
  | 'malayalam';

const FONT_PACKAGE: Record<Script, string> = {
  latin: 'noto-sans',
  devanagari: 'noto-sans-devanagari',
  bengali: 'noto-sans-bengali',
  gujarati: 'noto-sans-gujarati',
  gurmukhi: 'noto-sans-gurmukhi',
  oriya: 'noto-sans-oriya',
  tamil: 'noto-sans-tamil',
  telugu: 'noto-sans-telugu',
  kannada: 'noto-sans-kannada',
  malayalam: 'noto-sans-malayalam',
};

const RANGES: [Script, RegExp][] = [
  ['devanagari', /[ऀ-ॿ]/],
  ['bengali', /[ঀ-৿]/],
  ['gurmukhi', /[਀-੿]/],
  ['gujarati', /[઀-૿]/],
  ['oriya', /[଀-୿]/],
  ['tamil', /[஀-௿]/],
  ['telugu', /[ఀ-౿]/],
  ['kannada', /[ಀ-೿]/],
  ['malayalam', /[ഀ-ൿ]/],
];

// Resolve fonts from the app's own node_modules, wherever the process was started from.
const nodeRequire = createRequire(`${process.cwd()}/package.json`);

function fontPath(script: Script, bold: boolean): string {
  const name = FONT_PACKAGE[script];
  const subset = script === 'latin' ? 'latin' : script;
  return nodeRequire.resolve(
    `@fontsource/${name}/files/${name}-${subset}-${bold ? 700 : 400}-normal.woff`,
  );
}

function scriptOf(char: string): Script {
  // The rupee sign is not in the Latin font, the Devanagari font has it.
  if (char === '₹') return 'devanagari';
  for (const [script, pattern] of RANGES) if (pattern.test(char)) return script;
  return 'latin';
}

/**
 * Splits text into runs of one script, so each run uses a font that has its
 * glyphs. Whitespace stays with the run before it. ASCII punctuation and digits
 * count as Latin, because the Indic fonts do not carry them.
 */
export function splitRuns(text: string): { script: Script; text: string }[] {
  const runs: { script: Script; text: string }[] = [];
  for (const char of text) {
    const script = /\s/.test(char)
      ? (runs.at(-1)?.script ?? 'latin')
      : scriptOf(char);
    const last = runs.at(-1);
    if (last && last.script === script) last.text += char;
    else runs.push({ script, text: char });
  }
  return runs;
}

/** The brand voice has no em dashes. Model text can slip one in, so tidy it. */
function tidy(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ', ').replace(/\s+/g, ' ').trim();
}

function minutes(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  return `${Math.round(seconds / 60)} min`;
}

/** Renders the call report as a PDF and resolves with the file bytes. */
export function buildReportPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 64, left: 52, right: 52 },
      bufferPages: true,
      info: {
        Title: `Sales call report: ${data.company}`,
        Author: 'Rothenhall',
        Subject: data.scenarioTitle,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      render(doc, data);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

type Doc = PDFKit.PDFDocument;

function render(doc: Doc, d: ReportData) {
  const registered = new Set<string>();
  const use = (script: Script, bold: boolean): string => {
    const name = `${script}-${bold ? 'b' : 'r'}`;
    if (!registered.has(name)) {
      doc.registerFont(name, fontPath(script, bold));
      registered.add(name);
    }
    return name;
  };

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  interface Piece {
    font: string;
    text: string;
    width: number;
  }

  /**
   * Writes a paragraph. Each word is split into script runs, each run is drawn
   * with a font that has its glyphs, and lines are wrapped by measured width.
   * PDFKit's own continued text wraps mixed fonts badly, so this lays it out.
   */
  const write = (
    text: string,
    opts: {
      size?: number;
      bold?: boolean;
      color?: string;
      x?: number;
      y?: number;
      width?: number;
      lineGap?: number;
      align?: 'left' | 'right';
    } = {},
  ) => {
    const size = opts.size ?? 10.5;
    const bold = opts.bold ?? false;
    const x0 = opts.x ?? left;
    const maxWidth = opts.width ?? width;
    const latin = use('latin', bold);
    doc.font(latin).fontSize(size);
    const spaceWidth = doc.widthOfString(' ');

    const words = tidy(text)
      .split(' ')
      .filter(Boolean)
      .map((word) => {
        const pieces: Piece[] = splitRuns(word).map((run) => {
          const font = use(run.script, bold);
          doc.font(font).fontSize(size);
          return { font, text: run.text, width: doc.widthOfString(run.text) };
        });
        return { pieces, width: pieces.reduce((sum, p) => sum + p.width, 0) };
      });

    // Greedy wrapping on measured width.
    const lines: { words: typeof words; width: number }[] = [];
    let current: typeof words = [];
    let currentWidth = 0;
    for (const word of words) {
      const next = current.length ? currentWidth + spaceWidth + word.width : word.width;
      if (current.length && next > maxWidth) {
        lines.push({ words: current, width: currentWidth });
        current = [word];
        currentWidth = word.width;
      } else {
        current.push(word);
        currentWidth = next;
      }
    }
    if (current.length) lines.push({ words: current, width: currentWidth });

    // The tallest font on the line sets its height. Indic fonts run taller.
    let lineHeight = 0;
    for (const word of words)
      for (const piece of word.pieces) {
        doc.font(piece.font).fontSize(size);
        lineHeight = Math.max(lineHeight, doc.currentLineHeight(true));
      }
    lineHeight += opts.lineGap ?? 3;

    let y = opts.y ?? doc.y;
    doc.fillColor(opts.color ?? COLOR.text);
    for (const line of lines) {
      if (opts.y === undefined && y + lineHeight > bottom()) {
        doc.addPage();
        y = doc.y;
      }
      let x = opts.align === 'right' ? x0 + maxWidth - line.width : x0;
      line.words.forEach((word, i) => {
        if (i > 0) x += spaceWidth;
        for (const piece of word.pieces) {
          doc.font(piece.font).fontSize(size).fillColor(opts.color ?? COLOR.text);
          doc.text(piece.text, x, y, { lineBreak: false });
          x += piece.width;
        }
      });
      y += lineHeight;
    }
    doc.y = y;
  };

  const space = (pts: number) => {
    doc.y += pts;
  };

  const ensure = (needed: number) => {
    if (doc.y + needed > bottom()) doc.addPage();
  };

  // ---- Header band
  doc.rect(0, 0, doc.page.width, 6).fill(COLOR.copper);
  write('Rothenhall', { size: 17, bold: true, color: COLOR.ink, y: 32 });
  write('Sales Call Trainer report', {
    size: 9.5,
    color: COLOR.muted,
    align: 'right',
    y: 33,
  });
  write(
    d.generatedAt.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
    { size: 9.5, color: COLOR.muted, align: 'right', y: 47 },
  );
  doc.y = 62;
  space(14);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .strokeColor(COLOR.line)
    .lineWidth(1)
    .stroke();
  space(16);

  // ---- Title and meta
  write(d.mode === 'you-sell' ? 'How your call went' : 'How the AI caller did', {
    size: 22,
    bold: true,
    color: COLOR.ink,
  });
  space(4);
  write(d.scenarioTitle, { size: 12.5, color: COLOR.text });
  space(6);
  const meta = [
    d.company,
    `${d.buyerName}${d.buyerRole ? `, ${d.buyerRole}` : ''}`,
    `${d.difficulty} difficulty`,
    d.language,
    minutes(d.durationSeconds),
  ].filter(Boolean);
  write(meta.join('   |   '), { size: 9.5, color: COLOR.muted });
  space(16);

  // ---- Verdict card
  const cardTop = doc.y;
  const average =
    d.scorecard.dimensions.reduce((s, x) => s + x.score, 0) /
    Math.max(1, d.scorecard.dimensions.length);
  const verdictText = d.scorecard.verdict || d.scorecard.summary;
  doc.font(use('latin', false)).fontSize(12.5);
  const verdictHeight = doc.heightOfString(tidy(verdictText), { width: width - 150, lineGap: 3 });
  const cardHeight = Math.max(96, verdictHeight + 62);
  doc.roundedRect(left, cardTop, width, cardHeight, 10).fill(COLOR.ink);
  doc.fillColor('#e8b98a').font(use('latin', true)).fontSize(8.5)
    .text('FINAL VERDICT', left + 20, cardTop + 16, { characterSpacing: 1.4 });
  doc.fillColor('#ffffff').font(use('latin', true)).fontSize(30)
    .text(average.toFixed(1), left + 20, cardTop + 32, { continued: true })
    .fontSize(12).fillColor('#bdb4a3').text(' / 5');
  doc.fillColor('#e8b98a').font(use('latin', true)).fontSize(9)
    .text(OUTCOME_LABEL[d.scorecard.outcome].toUpperCase(), left + 20, cardTop + 74, { characterSpacing: 1.2 });
  doc.y = cardTop + 18;
  write(verdictText, {
    size: 12.5,
    color: '#ffffff',
    x: left + 140,
    width: width - 160,
    lineGap: 3,
  });
  doc.y = cardTop + cardHeight + 20;

  // ---- Summary
  heading('The short version');
  write(d.scorecard.summary, { size: 11 });
  space(14);

  // ---- Scores
  heading('Scores');
  for (const dim of d.scorecard.dimensions) {
    ensure(54);
    const rowTop = doc.y;
    write(dim.name, { size: 11, bold: true, color: COLOR.ink, width: 150 });
    for (let i = 0; i < 5; i++) {
      doc
        .roundedRect(left + 160 + i * 34, rowTop + 3, 30, 9, 3)
        .fill(i < dim.score ? COLOR.copper : COLOR.line);
    }
    doc.font(use('latin', true)).fontSize(10).fillColor(COLOR.ink)
      .text(`${dim.score}/5`, left + 160 + 5 * 34 + 6, rowTop + 2, { lineBreak: false });
    doc.y = rowTop + 20;
    write(dim.note, { size: 10, color: COLOR.muted });
    space(8);
  }
  space(4);

  // ---- Lists
  const list = (title: string, items: string[] | undefined, color: string) => {
    if (!items?.length) return;
    ensure(60);
    heading(title);
    for (const item of items) {
      ensure(34);
      const y = doc.y;
      doc.circle(left + 4, y + 6, 2.6).fill(color);
      write(item, { x: left + 16, width: width - 16, size: 10.5 });
      space(5);
    }
    space(8);
  };

  list('What went well', d.scorecard.strengths, COLOR.good);
  list('Where to improve', d.scorecard.improvements, COLOR.warn);
  if (d.mode === 'you-sell') {
    list('Lines that would have landed better', d.scorecard.betterMoves, COLOR.copper);
    list('Habits of a better calling agent', d.scorecard.coaching, COLOR.copper);
  } else {
    list('What an AI caller brings to your pipeline', d.scorecard.benefits, COLOR.copper);
  }

  // ---- Call to action
  ensure(92);
  const ctaTop = doc.y;
  doc.roundedRect(left, ctaTop, width, 80, 10).fill(COLOR.canvas);
  doc.rect(left, ctaTop, 4, 80).fill(COLOR.copper);
  doc.y = ctaTop + 14;
  write('Want your whole team calling this well?', {
    size: 13,
    bold: true,
    color: COLOR.ink,
    x: left + 22,
    width: width - 44,
  });
  space(3);
  write(
    'Rothenhall runs the go-to-market and revenue operations behind it. Talk to us about putting this in your pipeline.',
    { size: 10, color: COLOR.text, x: left + 22, width: width - 44 },
  );
  space(3);
  doc.font(use('latin', true)).fontSize(10).fillColor(COLOR.copper)
    .text('rothenhall.com/contact', left + 22, doc.y, {
      link: 'https://rothenhall.com/contact',
      underline: true,
    });
  doc.y = ctaTop + 80 + 18;

  // ---- Transcript
  if (d.turns.length) {
    doc.addPage();
    heading('The call, line by line');
    const you = d.mode === 'you-sell' ? 'You' : d.buyerName;
    const caller = d.mode === 'you-sell' ? d.buyerName : 'AI caller';
    for (const turn of d.turns.slice(0, 80)) {
      ensure(40);
      const mine = turn.speaker === 'user';
      write(mine ? you : caller, {
        size: 8.5,
        bold: true,
        color: mine ? COLOR.copper : COLOR.muted,
      });
      write(turn.text, { size: 10.5, color: COLOR.text });
      space(7);
    }
  }

  // ---- Footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Footer text sits inside the bottom margin. Without this, PDFKit adds a
    // page for every footer it is asked to draw there.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 40;
    doc.moveTo(left, y - 8).lineTo(left + width, y - 8).strokeColor(COLOR.line).lineWidth(0.8).stroke();
    doc.font(use('latin', false)).fontSize(8.5).fillColor(COLOR.muted)
      .text('Rothenhall  |  Be the company the AI recommends.  |  rothenhall.com', left, y, {
        width: width - 60,
        lineBreak: false,
      });
    doc.text(`Page ${i + 1} of ${range.count}`, left + width - 60, y, {
      width: 60,
      align: 'right',
      lineBreak: false,
    });
  }

  function heading(text: string) {
    ensure(40);
    doc.font(use('latin', true)).fontSize(8.5).fillColor(COLOR.copper)
      .text(text.toUpperCase(), left, doc.y, { characterSpacing: 1.3 });
    space(7);
  }
}
