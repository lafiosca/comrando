// Dialogue codec for bank 0B. See docs/rom-notes.md#text-and-messages.
//
// Message n's pointer is at 0B:$8004 + 2*(n-2) (game code passes Y = 2*(n-2) to $D730). Each message is
// [header][length][chars]: the header picks the box/portrait, text is fixed 16-column lines (no newline code).
// Replacing messages reclaims their old bytes (plus the free gaps 0B:$A780-$A7FF, $B700-$B7FF and $BCC0-$BE3F) and best-fit packs the new text,
// once per ROM (generate collects every text change into one call).

const BANK0B = 0x10 + 0x0b * 0x4000; // file offset of CPU $8000 in bank 0B
const PTR_BASE = 0x8004;
// Pointer slots $8004-$8103 (the first message starts at $8104), i.e. messages 2-129.
const FIRST = 2,
  LAST = 129;
const FREE_START = 0xa780,
  FREE_END = 0xa800;
/** Unused EPROM fill (32-byte runs of $00/$FF) in bank 0B lent to text; the map-marker routine stops below it. */
export const TEXT_EXTRA_START = 0xb700,
  TEXT_EXTRA_END = 0xb800;
/** More of it, below the clear-screen names (clearscreen.ts). */
const TEXT_EXTRA2_START = 0xbcc0,
  TEXT_EXTRA2_END = 0xbe40;
/** And the clear screen's room (clearscreen.ts CLEAR_SPACE, written before the text): whatever fill it left at the end. */
const CLEAR_START = 0xbe40,
  CLEAR_END = 0xbf80;
/** A last bit of fill past the timer's bank 0B code ($BFC0-$BFC2, timer.ts), before the reset stub ($BFE0). */
const TEXT_EXTRA3_START = 0xbfc3,
  TEXT_EXTRA3_END = 0xbfe0;
export const LINE = 16;

const DECODE: Record<number, string> = {
  0x00: ' ',
  0x01: 'F',
  0x02: '0',
  0x03: 'G',
  0x04: '1',
  0x05: 'H',
  0x06: '2',
  0x07: 'I',
  0x08: '3',
  0x09: 'J',
  0x0a: '4',
  0x0b: 'K',
  0x0c: '5',
  0x0d: 'L',
  0x0e: '6',
  0x0f: 'M',
  0x10: '7',
  0x11: 'N',
  0x12: '8',
  0x13: 'O',
  0x14: '9',
  0x15: 'P',
  0x16: 'A',
  0x17: 'Q',
  0x18: 'B',
  0x19: 'R',
  0x1a: 'C',
  0x1b: 'S',
  0x1c: 'D',
  0x1d: 'T',
  0x1e: 'E',
  0x1f: 'U',
  0x20: 'V',
  0x21: '+',
  0x22: 'W',
  0x23: '^',
  0x24: 'X',
  0x26: 'Y',
  0x28: 'Z',
  0x2a: ',',
  0x2c: "'",
  0x2e: '*',
  0x30: '.',
  0x32: '?',
  0x34: '!',
  0x36: 'α',
  0x38: 'β',
  0x3a: 'γ',
  0x3c: 'δ',
  0x3e: '-',
};
const ENCODE = new Map(Object.entries(DECODE).map(([code, ch]) => [ch, Number(code)]));

const cpuToFile = (addr: number) => BANK0B + addr - 0x8000;
const ptrOffset = (n: number) => cpuToFile(PTR_BASE + 2 * (n - 2));

/** The message number the game shows for `LDY #y / JSR $D730`. */
export const messageForY = (y: number) => y / 2 + 2;

export function encodeText(text: string): Uint8Array {
  return Uint8Array.from(text, (ch) => {
    const code = ENCODE.get(/[a-z]/.test(ch) ? ch.toUpperCase() : ch);
    if (code === undefined) throw new Error(`character ${JSON.stringify(ch)} has no tile in the game font`);
    return code;
  });
}

/** Rows the message box shows before it waits for A. */
export const PAGE = 4;
/** The radio box's (style 1: comm rooms, the intro briefing): 96 cells (VERIFIED in jsnes). */
export const RADIO_PAGE = 6;

/** Word-wrap into the game's fixed 16-column lines. "\n" forces a line break, "\f" a new page (`page` rows). */
export function wrap(text: string, width = LINE, page = PAGE): string {
  const lines: string[] = [];
  for (const para of text.replace(/\s*\f\s*/g, '\n\f').split('\n')) {
    if (para.startsWith('\f')) while (lines.length % page) lines.push('');
    let cur = '';
    for (const word of para.replace('\f', '').split(/ +/).filter(Boolean)) {
      if (!cur) cur = word;
      else if (cur.length + 1 + word.length <= width) cur += ` ${word}`;
      else {
        lines.push(cur);
        cur = word;
      }
      while (cur.length > width) {
        lines.push(cur.slice(0, width));
        cur = cur.slice(width);
      }
    }
    lines.push(cur);
  }
  return lines
    .map((l) => l.padEnd(width))
    .join('')
    .trimEnd();
}

function pointer(rom: Uint8Array, n: number): number {
  return rom[ptrOffset(n)] | (rom[ptrOffset(n) + 1] << 8);
}

export interface Message {
  header: number;
  text: string;
}

export function decodeText(bytes: Iterable<number>): string {
  let text = '';
  for (const b of bytes) text += DECODE[b] ?? `{${b.toString(16).padStart(2, '0')}}`;
  return text;
}

export function readMessage(rom: Uint8Array, n: number): Message | undefined {
  const p = pointer(rom, n);
  if (p < 0x8000) return undefined;
  const at = cpuToFile(p);
  const len = rom[at + 1];
  return { header: rom[at], text: decodeText(rom.subarray(at + 2, at + 2 + len)) };
}

/** Bank-0B messages: number -> CPU extent [start, end). Pointers outside $8000-$A7FF (e.g. into the fixed bank) are
 * not text in this bank and are left alone. */
function bankMessages(rom: Uint8Array): Map<number, [number, number]> {
  const ex = new Map<number, [number, number]>();
  for (let n = FIRST; n <= LAST; n++) {
    const p = pointer(rom, n);
    if (
      (p >= 0x8000 && p < FREE_END) ||
      (p >= TEXT_EXTRA_START && p < TEXT_EXTRA_END) ||
      (p >= TEXT_EXTRA2_START && p < TEXT_EXTRA2_END)
    )
      ex.set(n, [p, p + 2 + rom[cpuToFile(p) + 1]]);
  }
  return ex;
}

/**
 * Replace messages. `repl` maps message number -> new text (already laid out, e.g. via `wrap`) or {header, text}.
 * `extra` texts get no message number: their CPU addresses are returned (in order) for the caller's own pointers.
 * Headers default to the original (keeps the speaker/portrait).
 *
 * Every bank-0B message is re-laid (largest first, best fit) into exactly the bytes the messages occupied before plus
 * the free gap 0B:$A780-$A7FF, so any combination fits as long as the total does. Bytes that weren't message text
 * (small gaps, the blobs referenced by $8000/$8002) are never touched. Deterministic for a given input.
 */
export function writeMessages(
  rom: Uint8Array,
  repl: Map<number, string | Message>,
  extra: (Message | { reserve: number })[] = [],
): number[] {
  const ex = bankMessages(rom);
  // (messages sharing one copy count once)
  const exts = [...new Map([...ex.values()].map((x) => [x.join(), x])).values()].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < exts.length; i++) {
    if (exts[i][0] < exts[i - 1][1]) throw new Error('text: overlapping messages; cannot repack');
  }
  // One repack per ROM: a repack's leftover holes aren't recorded anywhere, so a second one would lose them (and,
  // before this check, double-booked the gap). Collect all of a seed's text and write it once.
  for (let a = FREE_START; a < FREE_END; a++) {
    if (rom[cpuToFile(a)] !== 0xff) throw new Error('text: bank 0B already repacked (write all messages in one call)');
  }
  for (const [start, end] of [
    [TEXT_EXTRA_START, TEXT_EXTRA_END],
    [TEXT_EXTRA2_START, TEXT_EXTRA2_END],
  ]) {
    for (let a = start; a < end; a += 32) {
      const run = rom.subarray(cpuToFile(a), cpuToFile(a + 32));
      if (!run.every((b) => b === run[0]) || (run[0] !== 0 && run[0] !== 0xff))
        throw new Error(`text: 0B:$${start.toString(16).toUpperCase()} is not free`);
    }
  }
  const fill = (a: number) => ((a >> 5) & 1 ? 0x00 : 0xff); // (the EPROM fill: 32-byte runs of $FF, then $00)
  for (let a = TEXT_EXTRA3_START; a < TEXT_EXTRA3_END; a++)
    if (rom[cpuToFile(a)] !== fill(a)) throw new Error('text: 0B:$BFC3 is not free');
  let clearLeft = CLEAR_END;
  while (clearLeft > CLEAR_START && rom[cpuToFile(clearLeft - 1)] === fill(clearLeft - 1)) clearLeft--;
  // free space = merged message extents + the gap
  const free: [number, number][] = [];
  for (const [s, e] of [
    ...exts,
    [FREE_START, FREE_END],
    [TEXT_EXTRA_START, TEXT_EXTRA_END],
    [TEXT_EXTRA2_START, TEXT_EXTRA2_END],
    [clearLeft, CLEAR_END],
    [TEXT_EXTRA3_START, TEXT_EXTRA3_END],
  ] as [number, number][]) {
    if (s === e) continue;
    const last = free[free.length - 1];
    if (last && last[1] === s) last[1] = e;
    else free.push([s, e]);
  }
  const jobs: { n: number; bytes: Uint8Array }[] = [];
  for (const [n, [s, e]] of ex) {
    const v = repl.get(n);
    if (v === undefined) {
      jobs.push({ n, bytes: rom.slice(cpuToFile(s), cpuToFile(e)) });
      continue;
    }
    const { header, text } = typeof v === 'string' ? { header: rom[cpuToFile(s)], text: v } : v;
    const body = encodeText(text);
    if (body.length > 255) throw new Error(`message ${n} is ${body.length} characters (max 255)`);
    jobs.push({ n, bytes: Uint8Array.from([header, body.length, ...body]) });
  }
  for (const n of repl.keys()) if (!ex.has(n)) throw new Error(`message ${n} has no text in bank 0B to replace`);
  // extra texts with no message number (reached through their own pointers, e.g. boss lines): n = EXTRA + index;
  // `reserve` sets aside that many bytes for the caller (a table that points at the texts)
  const EXTRA = 1000;
  extra.forEach((m, i) => {
    if ('reserve' in m) {
      jobs.push({ n: EXTRA + i, bytes: new Uint8Array(m.reserve) });
      return;
    }
    const { header, text } = m;
    const body = encodeText(text);
    if (body.length > 255) throw new Error(`extra text ${i} is ${body.length} characters (max 255)`);
    jobs.push({ n: EXTRA + i, bytes: Uint8Array.from([header, body.length, ...body]) });
  });
  const extraAt: number[] = [];
  // (the lent EPROM fill keeps its bytes where no text lands)
  for (const [s, e] of [...exts, [FREE_START, FREE_END]]) rom.fill(0xff, cpuToFile(s), cpuToFile(e));
  // messages with the same header and text share one copy (hint mode Nonsense repeats its lines)
  const placed = new Map<string, number>();
  const point = (n: number, at: number) => {
    if (n >= EXTRA) extraAt[n - EXTRA] = at;
    else {
      rom[ptrOffset(n)] = at & 0xff;
      rom[ptrOffset(n) + 1] = at >> 8;
    }
  };
  for (const job of jobs.sort((a, b) => b.bytes.length - a.bytes.length || a.n - b.n)) {
    const key =
      job.n >= EXTRA && extra[job.n - EXTRA] && 'reserve' in extra[job.n - EXTRA] ? undefined : job.bytes.join(',');
    if (key !== undefined && placed.has(key)) {
      point(job.n, placed.get(key)!);
      continue;
    }
    // the message area and its gap first; the lent EPROM fill only for what doesn't fit there
    const lent = ([s]: [number, number]) => s >= TEXT_EXTRA_START;
    const fitting = free.filter(([s, e]) => e - s >= job.bytes.length);
    const fits = fitting.some((r) => !lent(r)) ? fitting.filter((r) => !lent(r)) : fitting;
    if (!fits.length) throw new Error(`text bank full: no room for message ${job.n} (${job.bytes.length} bytes)`);
    const slot = fits.reduce((a, b) => (b[1] - b[0] < a[1] - a[0] ? b : a));
    rom.set(job.bytes, cpuToFile(slot[0]));
    point(job.n, slot[0]);
    if (key !== undefined) placed.set(key, slot[0]);
    slot[0] += job.bytes.length;
  }
  return extraAt;
}
