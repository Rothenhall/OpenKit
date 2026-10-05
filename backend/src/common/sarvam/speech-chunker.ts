/**
 * Cuts a streaming model reply into speakable chunks, so text to speech can
 * start on the first sentence while the model is still writing the rest.
 *
 * A chunk ends at a sentence stop that is followed by whitespace (so "3.5"
 * and "Rs.50" stay whole). The first chunk may also end at a comma once it is
 * long enough, because time to first audio matters most. Later chunks that
 * are very short are merged forward, since tiny clips sound choppy.
 */
const STOPS = /[.!?।॥…]["')\]]*\s/;
const FIRST_COMMA_MIN = 45;
const MIN_LATER_CHARS = 24;
const MAX_CHARS = 220;

export class SpeechChunker {
  private buffer = '';
  private emitted = 0;

  /** Feed streamed text. Returns zero or more chunks that are ready to speak. */
  push(text: string): string[] {
    this.buffer += text;
    const ready: string[] = [];
    for (;;) {
      const cut = this.findCut();
      if (cut === -1) break;
      const chunk = this.buffer.slice(0, cut).trim();
      this.buffer = this.buffer.slice(cut);
      if (chunk) {
        ready.push(chunk);
        this.emitted++;
      }
    }
    return ready;
  }

  /** Whatever is left once the model has finished. */
  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = '';
    if (!rest) return [];
    this.emitted++;
    return [rest];
  }

  private findCut(): number {
    // Walk the stops. The first chunk goes at the first one, later chunks
    // keep merging forward until they are long enough to sound natural.
    let end = 0;
    for (;;) {
      const stop = STOPS.exec(this.buffer.slice(end));
      if (!stop) break;
      end += stop.index + stop[0].length;
      if (this.emitted === 0 || this.buffer.slice(0, end).trim().length >= MIN_LATER_CHARS)
        return end;
    }
    if (end > 0) return this.buffer.length > MAX_CHARS ? this.softCut() : -1;
    if (this.emitted === 0 && this.buffer.length >= FIRST_COMMA_MIN) {
      const comma = /[,;—:]\s/.exec(this.buffer.slice(FIRST_COMMA_MIN - 15));
      if (comma) return FIRST_COMMA_MIN - 15 + comma.index + comma[0].length;
    }
    return this.buffer.length > MAX_CHARS ? this.softCut() : -1;
  }

  /** A very long run with no stop. Cut at the last space so speech never stalls. */
  private softCut(): number {
    const space = this.buffer.lastIndexOf(' ', MAX_CHARS);
    return space > 40 ? space + 1 : this.buffer.length;
  }
}
