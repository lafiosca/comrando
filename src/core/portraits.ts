// Dialogue portraits drawn from the player's own ROM (for the simulator's items: Super Joe's face for Joe, the enemy
// soldier's for the underground passage's hostage). docs/rom-notes.md#portraits:
// the header's low nibble - 1 picks a pair (art index, palette offset) from the table 0B:$8002 points to; the
// art index picks the art (0F:$C34C: 64 tiles in banks 6-9) and the layout (0F:$C368: bank 0C, 6 x 8 cells of 8x8
// sprites, then their attributes); the palette offset picks 16 bytes of the groups 0B:$8000 points to.

const file = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + (cpu & 0x3fff);
const word = (rom: Uint8Array, at: number) => rom[at] | (rom[at + 1] << 8);
const FIXED = 0x0f,
  ART_TABLE = 0xc34c,
  LAYOUT_TABLE = 0xc368;

export const PORTRAIT_W = 48,
  PORTRAIT_H = 64;

/** The portrait of message header `header` as NES color indices, PORTRAIT_W x PORTRAIT_H (-1: transparent). */
export function portraitPixels(rom: Uint8Array, header: number): number[][] {
  const pairs = word(rom, file(0x0b, 0x8002)),
    groups = word(rom, file(0x0b, 0x8000));
  const pair = file(0x0b, pairs) + 2 * ((header & 0x0f) - 1);
  const y = rom[pair],
    palette = file(0x0b, groups) + rom[pair + 1];
  const art = word(rom, file(FIXED, ART_TABLE) + y),
    artAt = file(6 + (art >> 14), ((((art >> 8) & 0x3f) | 0x80) << 8) | (art & 0xff));
  const layoutAt = file(0x0c, word(rom, file(FIXED, LAYOUT_TABLE) + y));
  const out = Array.from({ length: PORTRAIT_H }, () => new Array<number>(PORTRAIT_W).fill(-1));
  for (let cell = 0; cell < 48; cell++) {
    const tile = rom[layoutAt + cell],
      attr = rom[layoutAt + 48 + cell];
    if (tile >= 0x80) continue;
    const pal = attr & 3,
      hflip = attr & 0x40,
      vflip = attr & 0x80,
      cx = (cell % 6) * 8,
      cy = Math.floor(cell / 6) * 8;
    for (let r = 0; r < 8; r++) {
      const lo = rom[artAt + 16 * tile + r],
        hi = rom[artAt + 16 * tile + 8 + r];
      for (let b = 0; b < 8; b++) {
        const v = ((lo >> (7 - b)) & 1) | (((hi >> (7 - b)) & 1) << 1);
        if (v) out[cy + (vflip ? 7 - r : r)][cx + (hflip ? 7 - b : b)] = rom[palette + pal * 4 + v] & 0x3f;
      }
    }
  }
  return out;
}
