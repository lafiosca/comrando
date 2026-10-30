// Vanilla typos in the dialogue (cosmetic option "Typos"). Each fix edits the vanilla text in place, keeping its
// 16-column layout; messages the randomizer rewrites anyway (story, hints) are fixed by their new text instead.

import { LINE, messageForY, PAGE, readMessage } from './text.ts';

/** Message Y -> [vanilla text, fixed text] fragments (whole 16-column lines where the layout changes). */
const FIXES: [number, string, string][] = [
  [0x86, "IT'TOO EARLY TO FEEL SAFE.      ", "IT'S TOO EARLY  TO FEEL SAFE.   "], // #69, the escape cyborg
  [0xd2, 'EXPLOD IN       ', 'EXPLODE IN      '], // #107, the self-destruct warning
  [0x8c, 'TRANSFERED JOE  ', 'TRANSFERRED JOE '], // #72, Area 9's boss
  [0x38, 'FF BATALLION,   ', 'FF BATTALION,   '], // #30
  [0x72, 'THAT,S VERY     ', "THAT'S VERY     "], // #59
  [0xd6, "CRET DOCUMENTS'", 'CRET DOCUMENTS '], // #109, Joe's rescue story (a stray apostrophe)
  [0xec, 'SPECIAL MISSION***              ', 'SPECIAL         MISSION***      '], // #120, the intro (*** split over a line)
];

/** The fixed texts, by message number. Throws if a vanilla text isn't as expected. */
export function typoFixes(rom: Uint8Array): Map<number, string> {
  const out = new Map<number, string>();
  for (const [y, from, to] of FIXES) {
    const n = messageForY(y);
    const text = readMessage(rom, n)?.text ?? '';
    if (!text.includes(from)) throw new Error(`typos: unexpected text in message ${n}`);
    out.set(n, text.replace(from, to));
  }
  return out;
}

/** Text as its 16-column rows (trailing padding dropped), and back (each row padded but the last). */
const toRows = (text: string) => {
  const rows: string[] = [];
  for (let i = 0; i < text.length; i += LINE) rows.push(text.slice(i, i + LINE).trimEnd());
  return rows;
};
const fromRows = (rows: string[]) => rows.map((r, i) => (i < rows.length - 1 ? r.padEnd(LINE) : r)).join('');

/** Let each overflowing row of `out` from `j` hand its last words down to the next, up to row `last`. */
function cascade(out: string[], j: number, last: number): boolean {
  for (; j <= last; j++) {
    if (out[j].length <= LINE) continue;
    const carry: string[] = [];
    while (out[j].length > LINE) {
      const sp = out[j].lastIndexOf(' ');
      if (sp <= 0) break;
      carry.unshift(out[j].slice(sp + 1));
      out[j] = out[j].slice(0, sp);
    }
    if (out[j].length > LINE || j === last) return false;
    out[j + 1] = [...carry, out[j + 1] ?? ''].filter(Boolean).join(' ');
  }
  return true;
}

/**
 * Edit row `k` (`edit` gets rows and k's index in them), then let each overflowing row hand its last words down to the
 * next. First within k's page (the page breaks don't move); else, across the following pages as long as the message
 * keeps its number of pages ("OK, OK, I'LL" / "TALK."). True (and `rows` updated) if it fits; else
 * `rows` stays as it was.
 */
function reflow(rows: string[], k: number, edit: (out: string[], j: number) => void): boolean {
  const page = k - (k % PAGE),
    out = rows.slice(page, page + PAGE);
  while (out.length < PAGE) out.push(''); // (rows past the message's end, on its last page)
  edit(out, k - page);
  if (out.length === PAGE && cascade(out, k - page, PAGE - 1)) {
    // (an edit reaching the next page: the whole message)
    const used = Math.max(...out.map((r, i) => (r ? i + 1 : 0)), Math.min(PAGE, rows.length - page));
    rows.splice(page, Math.min(PAGE, rows.length - page), ...out.slice(0, used));
    return true;
  }
  const pages = Math.ceil(rows.length / PAGE),
    all = rows.slice();
  while (all.length < pages * PAGE) all.push('');
  edit(all, k);
  if (!cascade(all, k, pages * PAGE - 1)) return false;
  while (all.length > rows.length && !all[all.length - 1]) all.pop();
  rows.splice(0, rows.length, ...all);
  return true;
}

/** Vanilla lists of three areas get an Oxford comma ("AREAS 1,4 AND 5." -> "AREAS 1,4, AND 5.", then spaced by
 * spaceCommas), where it fits (reflow). */
export function oxfordCommas(text: string): string {
  const rows = toRows(text);
  let changed = false;
  rows.forEach((row, k) => {
    const m = row.match(/\d,\d+(?= AND \d)/);
    if (!m) return;
    const at = m.index! + m[0].length;
    if (
      reflow(rows, k, (out, j) => {
        out[j] = `${out[j].slice(0, at)},${out[j].slice(at)}`;
      })
    )
      changed = true;
  });
  return changed ? fromRows(rows) : text;
}

/**
 * The vanilla dialogue never puts a space after a comma ("FIRST,GO SEE THEM."). Add one wherever it fits: the row shifts into its padding (free; a message's last row, unpadded, grows a byte), or a full row
 * pushes words down within its page (reflow: "THIS IS LADD," / "OUR MISSION AC-"). Otherwise the comma stays as it
 * was ("AREAS 1,4 AND 5." on a page's last row). A comma ending a row needs none.
 */
export function spaceCommas(text: string): string {
  const rows = toRows(text);
  let changed = false;
  for (let k = 0; k < rows.length; k++) {
    for (let c = rows[k].indexOf(','); c >= 0 && c < rows[k].length - 1; c = rows[k].indexOf(',', c + 1)) {
      if (rows[k][c + 1] === ' ') continue;
      const at = c;
      if (
        reflow(rows, k, (out, j) => {
          out[j] = `${out[j].slice(0, at + 1)} ${out[j].slice(at + 1)}`;
        })
      )
        changed = true;
    }
  }
  return changed ? fromRows(rows) : text;
}

/** A space after "MR." too ("MR.JOE.", "MR.KILLT."), the same way. */
export function spaceTitles(text: string): string {
  const rows = toRows(text);
  let changed = false;
  for (let k = 0; k < rows.length; k++) {
    const at = rows[k].search(/\bMR\.\S/) + 2; // (the period)
    if (at < 2) continue;
    if (
      reflow(rows, k, (out, j) => {
        out[j] = `${out[j].slice(0, at + 1)} ${out[j].slice(at + 1)}`;
      })
    )
      changed = true;
  }
  return changed ? fromRows(rows) : text;
}

/** Words the vanilla text breaks over two rows with a hyphen, whole again where the page has room:
 * the broken halves -> the word (BATTALL-ION misspelled too; MACHINE-GUN as two words). */
const HYPHENATED: Record<string, string> = {
  'AC-COMPLISHED.': 'ACCOMPLISHED.',
  'BATTALL-ION': 'BATTALION',
  'MACHINE-GUN': 'MACHINE GUN',
  'WITH-OUT': 'WITHOUT',
  'UNDER-GROUND': 'UNDERGROUND',
  'BE-TWEEN': 'BETWEEN',
  'SOME-THING': 'SOMETHING',
  'HEAD-QUARTERS.': 'HEADQUARTERS.',
};

/** Join HYPHENATED's words: the first half leaves its row, the whole word starts the next (reflow). */
export function joinHyphens(text: string): string {
  const rows = toRows(text);
  let changed = false;
  for (let k = 0; k < rows.length - 1; k++) {
    if (!rows[k].endsWith('-')) continue;
    const head = rows[k].match(/[^ ,]+-$/)?.[0] ?? '',
      [tail, ...rest] = rows[k + 1].split(' '); // ("CAPTAIN,SOME-": SOME-)
    const word = HYPHENATED[head + tail];
    if (!word) continue;
    if (
      reflow(rows, k, (out, j) => {
        out[j] = out[j].slice(0, -head.length).trimEnd();
        out[j + 1] = [word, ...rest].join(' ');
      })
    )
      changed = true;
  }
  return changed ? fromRows(rows) : text;
}

/** One space after a sentence's end within a row, not two ("INFOR-MATION.  IGNORE"; the only vanilla
 * case: menus' column gaps have no punctuation before them). The row shifts left into its padding. */
export function singleSpaces(text: string): string {
  const rows = toRows(text);
  const out = rows.map((r) => r.replace(/([.!?]) {2,}(?=\S)/g, '$1 '));
  return out.some((r, i) => r !== rows[i]) ? fromRows(out) : text;
}
