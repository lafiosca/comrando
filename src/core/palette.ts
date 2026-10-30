// Player sprite palette swap. See docs/rom-notes.md#palettes-and-cosmetics.
//
// Every room has a 32-byte palette block in bank 01 (file 0x0727A-0x0790F; the randomizer adds room copies at
// 0x05D10-0x0600F). Blocks that draw the player hold
// sprite palette 0 (head: skin, hair, outline) at +0x11 and sprite palette 1 (body: highlight, uniform, outline)
// at +0x15. We recolor the hair (+0x12) and uniform (+0x16) bytes in every block carrying those palettes.

import { ROBOT_GROUP } from './robotportrait.ts';
import type { Rng } from './rng.ts';

const BLOCKS_START = 0x0727a;
const BLOCKS_END = 0x07910;
/** Room-specific copies the randomizer makes (pickups.ts: bank 01 free $9D00-$9EFF). */
const EXTRA_START = 0x05d10;
const EXTRA_END = 0x05f10; // ($9F00-$9FFF is the timer's code)
const BLOCK_SIZE = 32;
const SPR0 = 0x11;
const SPR1 = 0x15;
const HEAD = [0x36, 0x06, 0x0f];
const BODY = [0x20, 0x2a, 0x0f];

/** NES palette indices for uniform presets (vanilla is lime 0x2A). One name per color in every list. */
export const UNIFORM_COLORS: Record<string, number> = {
  lime: 0x2a,
  blue: 0x12,
  brown: 0x07,
  charcoal: 0x00,
  cyan: 0x2c,
  green: 0x1a,
  ginger: 0x17,
  gold: 0x28,
  lavender: 0x23,
  raspberry: 0x15, // (the enemies' vanilla color)
  navy: 0x02,
  olive: 0x18,
  orange: 0x27,
  pink: 0x24,
  purple: 0x14,
  red: 0x16,
  silver: 0x3d,
  'sky blue': 0x21,
  teal: 0x1c,
  violet: 0x13, // (named as in HAIR_COLORS)
};

/** NES palette indices for enemy uniform presets: the player's, vanilla (raspberry 0x15) first. One name per color in
 * every list. */
export const ENEMY_COLORS: Record<string, number> = {
  raspberry: 0x15,
  ...Object.fromEntries(Object.entries(UNIFORM_COLORS).filter(([k]) => k !== 'raspberry')),
};

/** NES palette indices for hair presets (vanilla is auburn 0x06; chosen to read on both the sprite and the
 * portraits, docs/rom-notes.md#palettes-and-cosmetics). */
export const HAIR_COLORS: Record<string, number> = {
  auburn: 0x06,
  black: 0x0f, // (portraits: blue-black, PORTRAIT_HAIR)
  blond: 0x37,
  blue: 0x12,
  brown: 0x07,
  cyan: 0x2c,
  ginger: 0x17,
  grey: 0x10,
  green: 0x1a,
  lavender: 0x23,
  lime: 0x2a,
  raspberry: 0x15,
  navy: 0x02,
  orange: 0x27,
  pink: 0x24,
  purple: 0x14,
  red: 0x16,
  silver: 0x3d,
  'sky blue': 0x21,
  teal: 0x1c,
  violet: 0x13,
  white: 0x30,
  gold: 0x28,
};

/** Portraits (dialogue close-ups, the area-clear screen) draw on black, so black hair there is anime-style blue-black. */
const PORTRAIT_HAIR: Record<number, number> = { 0x0f: 0x0c };
const portraitHair = (hair: number) => PORTRAIT_HAIR[hair] ?? hair;

/**
 * Hardcoded copies of the player colors outside the room blocks; the game writes these into its palette buffer
 * ($00D0-$00EF) directly, so they must be patched too or the vanilla colors come back.
 * `expect` guards against patching the wrong bytes; hair/uniform are offsets within `at`.
 */
const FIXED_SITES: {
  at: number;
  expect: number[];
  hair: number[];
  uniform: number[];
  what: string;
  portrait?: boolean;
}[] = [
  // 0F:$D891, copied to sprite palettes 0-1 by 0F:$D883 (e.g. restoring the player after the damage flash)
  { at: 0x3d8a1, expect: [0x36, 0x06, 0x0f, 0x0f, 0x20, 0x2a, 0x0f], hair: [1], uniform: [5], what: 'player restore' },
  // 0F:$D8B8, sprite palette 0 of the default full-screen palette loaded by 0F:$D898 (door transitions)
  { at: 0x3d8c8, expect: [0x0f, 0x20, 0x2a, 0x0f], hair: [], uniform: [2], what: 'transition palette' },
  // 0D:$B68A, copied to sprite palettes 0-1 by 0D:$B6A8
  { at: 0x3769a, expect: [0x36, 0x06, 0x0f, 0x0f, 0x20, 0x2a, 0x0f], hair: [1], uniform: [5], what: 'bank 0D scene' },
  // 0F:$D918, sprite palettes of the area-clear screen (full-screen palette $D8A8+$60, loaded by 0A:$B116);
  // the portrait uses the uniform green in sprite palettes 0 and 1 and the hair red in 0 and 3
  {
    at: 0x3d928,
    expect: [0x0f, 0x36, 0x06, 0x2a, 0x0f, 0x30, 0x2a, 0x26, 0x0f, 0x30, 0x10, 0x26, 0x0f, 0x36, 0x06, 0x27],
    hair: [2, 14],
    uniform: [3, 6],
    what: 'area-clear portrait',
    portrait: true,
  },
];

function matches(rom: Uint8Array, at: number, bytes: number[]): boolean {
  return bytes.every((b, i) => rom[at + i] === b);
}

/** File offsets of palette blocks that carry the player's sprite palettes. */
export function playerPaletteBlocks(rom: Uint8Array): number[] {
  const out: number[] = [];
  for (const [start, end] of [
    [BLOCKS_START, BLOCKS_END],
    [EXTRA_START, EXTRA_END],
  ]) {
    for (let b = start; b + BLOCK_SIZE <= end; b += BLOCK_SIZE) {
      if (matches(rom, b + SPR0, HEAD) && matches(rom, b + SPR1, BODY)) out.push(b);
    }
  }
  return out;
}

/** A preset (or the vanilla one); `random` picks one whose color isn't `avoid` (the other side's uniform). */
function resolve(
  choice: string,
  presets: Record<string, number>,
  vanillaKey: string,
  rng: Rng,
  avoid?: number,
): { key: string; value: number } {
  if (choice === 'vanilla') return { key: vanillaKey, value: presets[vanillaKey] };
  const key = choice === 'random' ? rng.pick(Object.keys(presets).filter((k) => presets[k] !== avoid)) : choice;
  return { key, value: presets[key] };
}

/** The enemy uniform's color for a fixed choice (vanilla or a preset); undefined for `random`. */
export const enemyColorValue = (choice: string) =>
  choice === 'random' ? undefined : ENEMY_COLORS[choice === 'vanilla' ? 'raspberry' : choice];

export interface PaletteResult {
  uniform: string;
  hair: string;
  blocks: number;
}

/** `avoidUniform`: a random uniform isn't this color (the enemies' fixed one). */
export function applyPlayerPalette(
  rom: Uint8Array,
  uniformChoice: string,
  hairChoice: string,
  rng: Rng,
  avoidUniform?: number,
): PaletteResult {
  const blocks = playerPaletteBlocks(rom);
  const uniform = resolve(uniformChoice, UNIFORM_COLORS, 'lime', rng, avoidUniform);
  const hair = resolve(hairChoice, HAIR_COLORS, 'auburn', rng);
  for (const b of blocks) {
    rom[b + SPR0 + 1] = hair.value;
    rom[b + SPR1 + 1] = uniform.value;
  }
  for (const site of FIXED_SITES) {
    if (!matches(rom, site.at, site.expect))
      throw new Error(`palette: unexpected bytes at ${site.what} (0x${site.at.toString(16)})`);
    for (const o of site.hair) rom[site.at + o] = site.portrait ? portraitHair(hair.value) : hair.value;
    for (const o of site.uniform) rom[site.at + o] = uniform.value;
  }
  applyPortraits(rom, uniform.value, portraitHair(hair.value));
  applyEndingScenes(rom, uniform.value, hair.value);
  return { uniform: uniform.key, hair: hair.key, blocks: blocks.length };
}

/**
 * The ending's scenes (bank 01 room palette blocks, docs/rom-notes.md#palettes-and-cosmetics): Ladd and Joe's
 * uniforms are their own greens there. Each takes the uniform colour as many rows darker as it sits below the vanilla
 * $2A. Hair: only the hanging Ladd's sprite (scenes 1-2); in the rope scene and the photo the hair colours are shared
 * with skin or with the other soldiers, so they stay.
 */
const ENDING_SITES: { at: number; expect: number[]; uniform: number[]; hair: number[]; what: string }[] = [
  // sprite palette 1 of scenes 1 (the base) and 2 (it blows up): the chopper's hanging Ladd, hair $06 and uniform $2A
  { at: 0x076da + 0x14, expect: [0x0f, 0x06, 0x2a, 0x0f], uniform: [2], hair: [1], what: 'ending scene 1' },
  { at: 0x076fa + 0x14, expect: [0x0f, 0x06, 0x2a, 0x0f], uniform: [2], hair: [1], what: 'ending scene 2' },
  // BG palettes 1-2 of scene 3 (Ladd and Joe on the rope): $19, $19 / $09
  {
    at: 0x077fa + 4,
    expect: [0x0f, 0x19, 0x27, 0x07, 0x0f, 0x27, 0x19, 0x09],
    uniform: [1, 6, 7],
    hair: [],
    what: 'ending scene 3',
  },
  // BG palettes 0 and 2 of scene 4 (the 1989.4.7 photo): $1A, $1B
  {
    at: 0x077da,
    expect: [0x0f, 0x1a, 0x07, 0x36, 0x0f, 0x01, 0x36, 0x07, 0x0f, 0x07, 0x1b, 0x00],
    uniform: [1, 10],
    hair: [],
    what: 'ending scene 4',
  },
];

/** `uniform`, `darker` rows darker (at most to the darkest row; the grays' hue $D darkens through the plain grays). */
export function uniformShade(uniform: number, darker: number): number {
  if (!darker) return uniform;
  const row = Math.max(0, (uniform >> 4) - darker);
  return (uniform & 0x0f) === 0x0d ? [0x00, 0x00, 0x10, 0x20][Math.max(0, 3 - darker)] : (row << 4) | (uniform & 0x0f);
}

function applyEndingScenes(rom: Uint8Array, uniform: number, hair: number) {
  for (const site of ENDING_SITES) {
    if (!matches(rom, site.at, site.expect))
      throw new Error(`palette: unexpected bytes at ${site.what} (0x${site.at.toString(16)})`);
  }
  for (const site of ENDING_SITES) {
    if (uniform !== UNIFORM_COLORS.lime)
      for (const o of site.uniform) rom[site.at + o] = uniformShade(uniform, 2 - (site.expect[o] >> 4));
    for (const o of site.hair) rom[site.at + o] = hair;
  }
}

/**
 * Dialogue close-ups (docs/rom-notes.md#portraits). Each portrait takes 4 sprite palettes from a
 * 16-byte group at 0B:$A68F + its offset in the per-portrait table 0B:$A70F (pairs: art, palette offset). The allies'
 * olive uniform ($18) is group 0's palette 2 (ally officer, HQ officer, the neutral-zone man's collar; the enemies in
 * that group use other palettes) and group 3's palette 3 (Ladd, Super Joe); Ladd's hair ($06) is group 3's palette 0,
 * which also draws Joe's eye lines, so Joe gets his own copy of group 3 in the unused block at offset $60.
 */
const PORTRAIT_GROUPS = 0x2e69f; // 0B:$A68F
const PORTRAIT_TABLE = 0x2e71f; // 0B:$A70F
const LADD_GROUP = PORTRAIT_GROUPS + 0x30;
const JOE_GROUP_OFFSET = 0x60;
const JOE_PORTRAIT = 3; // header low nibble 4

/** The portrait shade of a uniform colour: one row darker (vanilla lime $2A keeps its olive $18; gold stays gold, its
 * darker row being that same olive). */
export const portraitShade = (uniform: number) =>
  uniform === 0x2a ? 0x18 : uniform === 0x28 ? 0x28 : uniform >= 0x20 ? uniform - 0x10 : uniform;

function applyPortraits(rom: Uint8Array, uniform: number, hair: number) {
  if (uniform === UNIFORM_COLORS.lime && hair === HAIR_COLORS.auburn) return; // (vanilla)
  const joeGroup = PORTRAIT_GROUPS + JOE_GROUP_OFFSET;
  const checks: [number, number[], string][] = [
    [
      PORTRAIT_GROUPS,
      [0x0f, 0x26, 0x35, 0x06, 0x0f, 0x30, 0x35, 0x26, 0x0f, 0x26, 0x35, 0x18, 0x0f, 0x26, 0x35, 0x15],
      'portrait group 0',
    ],
    [
      LADD_GROUP,
      [0x0f, 0x26, 0x35, 0x06, 0x0f, 0x30, 0x35, 0x26, 0x0f, 0x26, 0x35, 0x17, 0x0f, 0x26, 0x35, 0x18],
      'portrait group 3',
    ],
    [joeGroup, new Array(16).fill(0x0f), 'unused portrait palettes'],
    [PORTRAIT_TABLE + 2 * JOE_PORTRAIT, [0x06, 0x30], "Joe's portrait entry"],
  ];
  for (const [at, bytes, what] of checks)
    if (!matches(rom, at, bytes)) throw new Error(`palette: unexpected bytes at ${what} (0x${at.toString(16)})`);
  rom.copyWithin(joeGroup, LADD_GROUP, LADD_GROUP + 16);
  rom[PORTRAIT_TABLE + 2 * JOE_PORTRAIT + 1] = JOE_GROUP_OFFSET;
  const shade = portraitShade(uniform);
  rom[PORTRAIT_GROUPS + 11] = shade;
  rom[LADD_GROUP + 15] = shade;
  rom[joeGroup + 15] = shade;
  rom[LADD_GROUP + 3] = hair;
}

/**
 * Enemy uniforms: the enemy red ($15) in every room's enemy sprite palettes (2 and 3: block +$1A, +$1E; the
 * randomizer's pickup room copies are skipped, their palette 2 is the item's) and in the enemy close-ups (portrait
 * group 0's palette 3: soldiers, the mustache guy, the commander; group 1: the cyborg; group 2: Killt).
 */
const ENEMY_RED = 0x15;
const ENEMY_PORTRAITS = [
  PORTRAIT_GROUPS + 15,
  PORTRAIT_GROUPS + 0x10 + 3,
  PORTRAIT_GROUPS + 0x10 + 15,
  PORTRAIT_GROUPS + 0x20 + 7,
  PORTRAIT_GROUPS + 0x20 + 11,
  PORTRAIT_GROUPS + 0x20 + 15,
];

/** `avoid`: a random enemy uniform isn't this color (the player's). */
export function applyEnemyPalette(rom: Uint8Array, choice: string, rng: Rng, avoid?: number): string {
  const { key, value } = resolve(choice, ENEMY_COLORS, 'raspberry', rng, avoid);
  if (value === ENEMY_RED) return key;
  for (let b = BLOCKS_START; b + BLOCK_SIZE <= BLOCKS_END; b += BLOCK_SIZE) {
    for (const o of [0x1a, 0x1e]) if (rom[b + o] === ENEMY_RED) rom[b + o] = value;
  }
  for (const at of ENEMY_PORTRAITS) {
    if (rom[at] !== ENEMY_RED) throw new Error(`palette: unexpected enemy portrait color at 0x${at.toString(16)}`);
    rom[at] = value;
  }
  // (the robot portrait's palettes, when installed: robotportrait.ts)
  for (const o of [1, 9, 13])
    if (rom[PORTRAIT_GROUPS + ROBOT_GROUP + o] === ENEMY_RED) rom[PORTRAIT_GROUPS + ROBOT_GROUP + o] = value;
  return key;
}
