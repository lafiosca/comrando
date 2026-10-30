// "BIONIC COMRANDO" title logo: the second M of COMMANDO redrawn as an R.
//
// The logo's background tiles are stored uncompressed in the ROM (title CHR at file 0x1C010, 16 bytes per tile) and
// every tile on the title screen is unique, so the edit is a rewrite of the 8 tiles that draw that M.
// The same data renders the page's logo image (src/make-logo.ts writes public/logo.png).

import { NES_RGB } from './nespal.ts';

const TITLE_CHR = 0x1c010;

/** Tiles $70-$73/$8C-$8F: the second M of COMMANDO, redrawn as an R (with the logo's black outline). */
const R_TILES: { tile: number; from: string; to: string }[] = [
  { tile: 0x70, from: '3f0000003c3e3e3fc0ffffc33d3e3e3f', to: '3f0000003f3f3f3fc0ffffc03f3f3f3f' },
  { tile: 0x71, from: '3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f', to: '3f3f3c3c3c3c3f3f3f3f3c3d3d3c3f3f' },
  { tile: 0x72, from: 'ff0000001e3e3e7e00ffffe1debebe7e', to: 'ff000000f8fcfefe00ffff03f9fcfefe' },
  { tile: 0x73, from: '7efefefefefefefe7efefefefefefefe', to: 'fefe1e1e1e1efefefefe1edede1efefe' },
  { tile: 0x8c, from: '3f3f3f3d3d3c3c3c3f3f3f3d3d3c3c3d', to: '3f3f3c3c3c3c3c3c3f3f3c3d3d3d3d3d' },
  { tile: 0x8d, from: '3c3c3c3c00100c023d3d3d3d010f0301', to: '3c3c3c3c00100c023d3d3d3d010f0301' },
  { tile: 0x8e, from: 'fefefedede9e9e1efefefedede9e9e5e', to: 'fcf878783c3c1e1efcf97b793dbc9ede' },
  { tile: 0x8f, from: '1e1e1e1e00000000dedededec0ffffff', to: '1e1e1e1e00000000dedededec0ffffff' },
];

const hex = (s: string) => Uint8Array.from(s.match(/../g)!, (b) => parseInt(b, 16));

/**
 * Tile $CD of the title-screen font is a narrow zero that the game uses as the letter O ("CAPCOM", "NINTENDO", "OF",
 * "CONTINUE", "GAME OVER"); no digit zero appears on those screens, and the font (CHR record $0D, room list $6E) is
 * only loaded for them. Redrawn as a full-width O like the font's other letters (M is c6 ee fe fe d6 c6 c6).
 */
const O_TILE = { tile: 0xcd, from: '3c66666666663c00', to: '7cc6c6c6c6c67c00' }; // (plane 0; plane 1 is blank)

/** Give the title, CONTINUE and GAME OVER screens a real O. Throws if the tile isn't the original. */
export function fixTitleLetterO(rom: Uint8Array): void {
  const at = TITLE_CHR + O_TILE.tile * 16;
  const from = [...hex(O_TILE.from), ...new Array(8).fill(0)];
  if (!from.every((b, i) => rom[at + i] === b)) throw new Error('title: unexpected bytes in the letter O tile');
  rom.set(hex(O_TILE.to), at);
}

/** Apply the COMRANDO logo edit. Throws if the tiles aren't the expected originals. */
export function applyTitleLogo(rom: Uint8Array): void {
  for (const { tile, from } of R_TILES) {
    const at = TITLE_CHR + tile * 16;
    if (!hex(from).every((b, i) => rom[at + i] === b))
      throw new Error(`title: unexpected bytes in tile $${tile.toString(16)}`);
  }
  for (const { tile, to } of R_TILES) rom.set(hex(to), TITLE_CHR + tile * 16);
}

/** Logo layout on the title screen (rows 4-17, cols 6-27): tile index per cell, -1 = empty. */
const LOGO_TILES: number[][] = [
  [-1, -1, 0x00, 0x02, -1, 0x22, -1, -1, -1, -1, -1, -1, -1, -1, 0x60, 0x62, 0xa0, 0xa2, -1, -1, -1, -1],
  [-1, -1, 0x01, 0x03, 0x21, 0x23, -1, -1, -1, -1, -1, -1, -1, -1, 0x61, 0x63, 0xa1, 0xa3, -1, -1, -1, -1],
  [
    -1, -1, 0x04, 0x06, 0x08, 0x0a, 0x0c, 0x0e, 0x10, 0x12, 0x14, 0x16, 0x18, 0x1a, 0x1c, 0x1e, 0xa4, 0xa6, -1, -1, -1,
    -1,
  ],
  [
    -1, -1, 0x05, 0x07, 0x09, 0x0b, 0x0d, 0x0f, 0x11, 0x13, 0x15, 0x17, 0x19, 0x1b, 0x1d, 0x1f, 0xa5, 0xa7, -1, -1, -1,
    -1,
  ],
  [
    -1, -1, 0x24, 0x26, 0x28, 0x2a, 0x2c, 0x2e, 0x30, 0x32, 0x34, 0x36, 0x38, 0x3a, 0x3c, 0x3e, 0xa8, 0xaa, -1, -1, -1,
    -1,
  ],
  [
    -1, -1, 0x25, 0x27, 0x29, 0x2b, 0x2d, 0x2f, 0x31, 0x33, 0x35, 0x37, 0x39, 0x3b, 0x3d, 0x3f, 0xa9, 0xab, -1, -1, -1,
    -1,
  ],
  [
    0x40, 0x42, 0x44, 0x46, 0x48, 0x4a, 0x4c, 0x4e, 0x50, 0x52, 0x54, 0x56, 0x58, 0x5a, 0x5c, 0x5e, 0xb4, 0xb6, 0xb8,
    0xba, 0xbc, 0xbe,
  ],
  [
    0x41, 0x43, 0x45, 0x47, 0x49, 0x4b, 0x4d, 0x4f, 0x51, 0x53, 0x55, 0x57, 0x59, 0x5b, 0x5d, 0x5f, 0xb5, 0xb7, 0xb9,
    0xbb, 0xbd, 0xbf,
  ],
  [
    -1, -1, 0x64, 0x66, 0x68, 0x6a, 0x6c, 0x6e, 0x70, 0x72, 0x74, 0x76, 0x78, 0x7a, 0x7c, 0x7e, 0xc0, 0xc2, -1, -1, -1,
    -1,
  ],
  [
    -1, -1, 0x65, 0x67, 0x69, 0x6b, 0x6d, 0x6f, 0x71, 0x73, 0x75, 0x77, 0x79, 0x7b, 0x7d, 0x7f, 0xc1, 0xc3, -1, -1, -1,
    -1,
  ],
  [
    -1, -1, 0x80, 0x82, 0x84, 0x86, 0x88, 0x8a, 0x8c, 0x8e, 0x90, 0x92, 0x94, 0x96, 0x98, 0x9a, 0x9c, 0x9e, -1, -1, -1,
    -1,
  ],
  [
    -1, -1, 0x81, 0x83, 0x85, 0x87, 0x89, 0x8b, 0x8d, 0x8f, 0x91, 0x93, 0x95, 0x97, 0x99, 0x9b, 0x9d, 0x9f, -1, -1, -1,
    -1,
  ],
  [-1, -1, -1, -1, -1, -1, -1, -1, 0xac, 0xae, 0xb0, 0xb2, -1, -1, -1, -1, -1, 0xcf, 0xd0, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1, -1, -1, 0xad, 0xaf, 0xb1, 0xb3, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
];

/** The ™ after COMRANDO (row 12). */
const TM_TILES = [0xcf, 0xd0];

/** Background palette (0-2) per cell, from the title screen's attribute table. */
const LOGO_PALS: string[] = [
  '0000000000000000000000',
  '0000000000000000000000',
  '0000000000000000000000',
  '0000000000000000000000',
  '0000000000000000000000',
  '0000000000000000000000',
  '1111111111111111111111',
  '1111111111111111111111',
  '0022222222222222220000',
  '0022222222222222220000',
  '0022222222222222220000',
  '0022222222222222220000',
  '0000000022220000000000',
  '0000000022220000000000',
];

/** Title screen background palettes 0-2 (NES color indices). */
const TITLE_BG_PAL = [0x0f, 0x20, 0x15, 0x2b, 0x0f, 0x20, 0x15, 0x00, 0x0f, 0x20, 0x15, 0x27];

/**
 * Render the logo from a verified ROM's tile data (with the R edit applied) as RGBA pixels at 1x, on the title
 * screen's black background (the logo's outlines are background color 0, so it needs the black behind it),
 * cropped to the artwork with `pad` pixels of black on every side.
 */
export function renderLogo(
  verifiedRom: Uint8Array,
  pad = 4,
): { width: number; height: number; rgba: Uint8ClampedArray } {
  const full = renderTiles(verifiedRom);
  let x0 = full.width,
    x1 = -1,
    y0 = full.height,
    y1 = -1;
  for (let y = 0; y < full.height; y++) {
    for (let x = 0; x < full.width; x++) {
      if (!full.art[y * full.width + x]) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const width = x1 - x0 + 1 + 2 * pad,
    height = y1 - y0 + 1 + 2 * pad;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const bg = full.rgba.subarray(0, 4); // pixel (0,0) is background
  for (let o = 0; o < rgba.length; o += 4) rgba.set(bg, o);
  for (let y = y0; y <= y1; y++) {
    const src = (y * full.width + x0) * 4;
    rgba.set(full.rgba.subarray(src, src + (x1 - x0 + 1) * 4), ((y - y0 + pad) * width + pad) * 4);
  }
  return { width, height, rgba };
}

function renderTiles(verifiedRom: Uint8Array): {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  art: Uint8Array;
} {
  const rom = verifiedRom.slice();
  applyTitleLogo(rom);
  const width = LOGO_TILES[0].length * 8,
    height = LOGO_TILES.length * 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const art = new Uint8Array(width * height); // 1 where a non-background color was drawn
  const [bgR, bgG, bgB] = NES_RGB[TITLE_BG_PAL[0] & 0x3f];
  for (let o = 0; o < rgba.length; o += 4) {
    rgba[o] = bgR;
    rgba[o + 1] = bgG;
    rgba[o + 2] = bgB;
    rgba[o + 3] = 255;
  }
  LOGO_TILES.forEach((row, r) =>
    row.forEach((tile, c) => {
      if (tile < 0 || TM_TILES.includes(tile)) return; // (the web page's logo goes without the ™)
      const pal = Number(LOGO_PALS[r][c]);
      const at = TITLE_CHR + tile * 16;
      for (let y = 0; y < 8; y++) {
        const lo = rom[at + y],
          hi = rom[at + 8 + y];
        for (let x = 0; x < 8; x++) {
          const v = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
          if (!v) continue; // background color: already filled
          const [red, green, blue] = NES_RGB[TITLE_BG_PAL[pal * 4 + v] & 0x3f];
          const o = ((r * 8 + y) * width + c * 8 + x) * 4;
          rgba[o] = red;
          rgba[o + 1] = green;
          rgba[o + 2] = blue;
          rgba[o + 3] = 255;
          art[o / 4] = 1;
        }
      }
    }),
  );
  return { width, height, rgba, art };
}
