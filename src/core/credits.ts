// Our credits in the ending (docs/design.md#credits-and-final-screen): the credits scene (1:$BDF0) opens with #36 ("BATTLE HAS ENDED…"),
// then the Capcom staff (#60, #89, #112). Every seed but a fully vanilla one says who made the ROM there instead.

import { LINE, PAGE } from './text.ts';

/** #36, the credits scene's first message (1:$BE41 `LDY #$44`); the story box (header $B0, no portrait). */
export const CREDITS_Y = 0x44;
export const CREDITS_HEADER = 0xb0;

/** The credits, line by line (leading spaces center them). `^` is the bullet icon. */
const CREDITS = [
  'BIONIC COMRANDO',
  '',
  '  DESIGNED BY',
  '   ^LAFIOSCA',
  '   CUSTOM ROM',
  '  GENERATED AT',
  '',
  '  COMRANDO.COM',
];

/** #36's new text: CREDITS as fixed 16-column rows (two pages). */
export function creditsText(): string {
  if (CREDITS.length % PAGE || CREDITS.some((l) => l.length > LINE)) throw new Error('credits: layout');
  return CREDITS.map((l) => l.padEnd(LINE))
    .join('')
    .trimEnd();
}

/**
 * Joe's letter (#37, ending scene 5) shows for a fixed time: step 3 (1:$BEAD) prints it and sets the countdown `$88/$89`
 * to $384 (900 frames), then the scene fades out. A page takes ~300 frames to type and read (vanilla's three pages fill
 * the 900), so a longer letter gets 300 per page plus a little, or its last page is cut off.
 */
export function setLetterWait(rom: Uint8Array, text: string) {
  const at = 0x10 + 0x01 * 0x4000 + 0xbeb4 - 0x8000;
  if (![0xa9, -1, 0x85, 0x88, 0xa9, -1, 0x85, 0x89].every((b, i) => b < 0 || rom[at + i] === b))
    throw new Error('credits: unexpected letter wait'); // (any wait: a retry sets it again)
  const pages = Math.ceil(text.length / (LINE * PAGE));
  const frames = Math.max(900, 300 * pages + 120);
  rom[at + 1] = frames & 0xff;
  rom[at + 5] = frames >> 8;
}
