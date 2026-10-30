// Building pickups that show (and give) any item. See docs/rom-notes.md#building-pickups.
//
// The item-pickup object ($79, 0F:$F5B1) takes its item from 0F:$F5FA + (room - $37) and its sprite from a bank-0A
// metasprite named by 0F:$F608 + 2·(room - $37). Here every item room draws its pickup from sprite tiles $C5-$C8
// (TL, TR, BL, BR, as the icons are stored), loaded per room:
//   - The sprite-CHR loader (0F:$D28D) walks a room's list of block ids, each a 5-byte copy record at bank 03 $BBB5 +
//     5·id. A helper (bank 03 free $AB80, called from 0F:$D2CE) makes id $7F special: it builds the record in RAM
//     ($01D8) from a per-room table, "copy this item's 4 icon tiles to PPU $0C50". Item rooms get a copy of their
//     list with $7F appended (plus spare id $17, the second half of the Permit icon, for Permit-shaped icons).
//   - The metasprite is TL/TR/BL/BR = $C5/$C6/$C7/$C8 (8x8 sprites) with the menu icon's palettes: menu palette 3 -> the room's
//     palette 3 (orange; not in room $44, where palette 3 is red and the pickup uses palette 2 only), anything else ->
//     palette 2, which no other object in these rooms uses, set to the item's colour in a room-specific copy of the
//     room's palette block (bank 01 free $9D00+).
// Room $44 (NZ19 building B) holds a 1UP object ($73) in vanilla; placing an item there turns it into a $79.

import { type Asm, assemble } from './asm.ts';
import { type Message, decodeText, wrap } from './text.ts';
import { CLEAR_NAMES, ITEMS, type Item } from './world.ts';
import { ALT_Y } from './roomtalk.ts';

const off01 = (cpu: number) => 0x10 + 0x01 * 0x4000 + cpu - 0x8000;
const off03 = (cpu: number) => 0x10 + 0x03 * 0x4000 + cpu - 0x8000;
const off0A = (cpu: number) => 0x10 + 0x0a * 0x4000 + cpu - 0x8000;
const off0F = (cpu: number) => 0x10 + 0x0f * 0x4000 + cpu - 0xc000;

/** Building rooms that can hold an item: the four vanilla item rooms and NZ19's 1UP room. */
export const PICKUP_ROOMS = [0x38, 0x39, 0x3c, 0x3d, 0x44] as const;

const ITEM_TABLE = 0xf5fa; // 0F, + room - $37
const ANIM_PTRS = 0xf608; // 0F, + 2·(room - $37)
const OBJECT_PTRS = 0x0ed7b; // file: bank 03 pointers to each room's object list, + 2·room
const CHR_LISTS = 0xb8e7; // 03: + 2·room
const CHR_RECORDS = 0xbbb5; // 03: + 5·id
const PAL_PTRS = 0x0719a; // file: bank 01 pointers to each room's palette block, + 2·room
const LOADER_SITE = 0xd2ce; // 0F: id·5 + record base -> ($19)
const HELPER = 0xab80; // 03 free $AB80-$ABFF
const LIST_SPACE = 0xb84b; // 03 free $B84B-$B86B
const LIST_END = 0xb86c;
const REC = 0x01d8; // RAM (the stack-page gap: markers $01D0-$01D2, Flak Map $01D3, rapid fire $01D4, timer $01CE and $01D5-$01D7, Area 12 boss $01DD)
const PERMIT_ID = 0x17; // spare block id: Permit icon tiles $50/$51 -> PPU $0C70 (tiles $C7/$C8)
/**
 * CHR record ids past the vanilla table (whose last record is $58; code follows it): the loader helper reads ids
 * $59-$5C from EXTRA_RECORDS instead. Every id below $59 but $17 and $45 is in some list (rooms $00-$6B and the other
 * screens' lists $6C-$71: $70 is the area-clear portrait's, $47).
 */
const EXTRA_FIRST = 0x59;
const EXTRA_RECORDS = 0xab67, EXTRA_COUNT = 5; // 03: in the zero fill before the helper ($AA20-$AB7F, unread in a 250k-frame trace)
/** Extra CHR record ids for the truck-stage bullet drop's tile and the blank below it (patches.ts topDownDrops). */
export const TRUCK_DROP_CHR_ID = 0x5a, TRUCK_BLANK_CHR_ID = 0x5d;
/**
 * The sprite-CHR loader's helper (03:$AB80, called from 0F:$D2CE): id $7F builds its record from `table` (source per
 * room $37-$44: the building pickup's icon), ids $59+ come from EXTRA_RECORDS, anything else as before.
 */
function installLoaderHelper(rom: Uint8Array, table: number[]) {
  expectBytes(rom, off0F(LOADER_SITE), [0x18, 0xa5, 0x19, 0x6d, 0x0b, 0xac, 0x85, 0x19, 0xa5, 0x1a, 0x6d, 0x0c, 0xac, 0x85, 0x1a], 'sprite CHR loader');
  expectBytes(rom, off03(HELPER), new Array(0x80).fill(0xff), 'free space 03:$AB80');
  const EXTRA_BASE = (EXTRA_RECORDS - 5 * EXTRA_FIRST) & 0xffff;
  const helper = (tableAt: number) => [
    0xa5, 0x1a, 0xc9, 0x02, { rel: 0xd0, to: 'normal' }, //   LDA $1A / CMP #2 / BNE normal  (id·5 = $027B: id $7F)
    0xa5, 0x19, 0xc9, 0x7b, { rel: 0xd0, to: 'normal' }, //   LDA $19 / CMP #$7B / BNE normal
    0xa5, 0x4c, 0x0a, 0xa8, //                              LDA $4C / ASL / TAY  (room·2, $6E for room $37)
    0xb9, (tableAt - 0x6e) & 0xff, (tableAt - 0x6e) >> 8, 0x8d, REC & 0xff, REC >> 8, // rec+0 = source lo
    0xb9, (tableAt - 0x6d) & 0xff, (tableAt - 0x6d) >> 8, 0x8d, (REC + 1) & 0xff, REC >> 8, // rec+1 = source hi|bank
    0xa9, 0x0c, 0x8d, (REC + 2) & 0xff, REC >> 8, //          rec+2,3 = PPU $0C50 (tile $C5)
    0xa9, 0x50, 0x8d, (REC + 3) & 0xff, REC >> 8,
    0xa9, 0x04, 0x8d, (REC + 4) & 0xff, REC >> 8, //          rec+4 = 4 tiles
    0xa0, 0x00, //                                          LDY #0 (the loader reads ($19),Y from 0)
    0xa9, REC & 0xff, 0x85, 0x19, 0xa9, REC >> 8, 0x85, 0x1a, 0x60, // ($19) = rec / RTS
    { label: 'normal' }, // ids $59+ (id·5 >= $1BD): ($19) = id·5 + EXTRA_RECORDS - $1BD
    0xa5, 0x1a, { rel: 0xf0, to: 'base' }, 0xc9, 0x02, { rel: 0xb0, to: 'extra' }, //  LDA $1A / BEQ base / CMP #2 / BCS extra
    0xa5, 0x19, 0xc9, (5 * EXTRA_FIRST) & 0xff, { rel: 0x90, to: 'base' }, //            LDA $19 / CMP #$BD / BCC base
    { label: 'extra' },
    0x18, 0xa5, 0x19, 0x69, EXTRA_BASE & 0xff, 0x85, 0x19, 0xa5, 0x1a, 0x69, EXTRA_BASE >> 8, 0x85, 0x1a, 0x60,
    { label: 'base' }, // the replaced code: ($19) = id·5 + record base, then RTS
    0x18, 0xa5, 0x19, 0x6d, 0x0b, 0xac, 0x85, 0x19, 0xa5, 0x1a, 0x6d, 0x0c, 0xac, 0x85, 0x1a, 0x60,
  ] satisfies Asm[];
  const tableAt = HELPER + assemble(HELPER, helper(0)).length;
  const code = [...assemble(HELPER, helper(tableAt)), ...table];
  if (code.length > 0x80) throw new Error(`pickups: loader helper too big (${code.length})`);
  expectBytes(rom, off03(EXTRA_RECORDS), new Array(5 * EXTRA_COUNT).fill(0x00), 'free space 03:$AB67');
  rom.set(code, off03(HELPER));
  rom.set([0x20, HELPER & 0xff, HELPER >> 8, ...new Array(12).fill(0xea)], off0F(LOADER_SITE)); // JSR helper
}

/** Write CHR record `id` (5 bytes: source lo, source hi|bank, PPU hi, PPU lo, tiles). */
export function setChrRecord(rom: Uint8Array, id: number, record: number[]) {
  if (id >= EXTRA_FIRST) {
    if (id - EXTRA_FIRST >= EXTRA_COUNT) throw new Error('pickups: no such extra CHR record');
    if (rom[off0F(LOADER_SITE)] !== 0x20) installLoaderHelper(rom, new Array(28).fill(0)); // (no building items placed)
    rom.set(record, off03(EXTRA_RECORDS + 5 * (id - EXTRA_FIRST)));
  } else rom.set(record, off03(CHR_RECORDS + 5 * id));
}
const PAL_SPACE = 0x9d00; // 01 free $9D00-$9DDF, 32-byte blocks: one per pickup room at most (5 item rooms and the
// 2 Destroyers'); $9DE0-$9EFF: finalscreen.ts; $9F00-$9FFF: timer.ts
const PAL_END = 0x9de0;
const ORANGE = 0x27; // palette 3 of the other building rooms

/** Pickup metasprite slots in bank 0A, per room: the four vanilla pickup records and one in free space. */
const ANIM_SLOT: Record<number, number> = { 0x38: 0xaac2, 0x3d: 0xaad3, 0x3c: 0xaae4, 0x39: 0xaaf5, 0x44: 0xbf90, 0x41: 0xab06, 0x42: 0xab06 };
/** NZ18's two Destroyer rooms: both pay out the same item, after YES to the real Destroyer (destroyers.ts). */
export const DESTROYER_ROOMS = [0x41, 0x42] as const;
/** Item-table value marking a Destroyer room (vanilla used the Machine Gun's $04, so no Machine Gun elsewhere). */
const DESTROYER_MARK = 0x7e;

interface Icon {
  /** File offset of the 4 icon tiles, stored TL, TR, BL, BR (menu icons, research table). */
  tiles: number;
  /** Permit-shaped: TR/BR come from the Permit's second half instead. */
  permit?: boolean;
  /** Palette per quadrant TL, BL, TR, BR (the order the building metasprite reads them in): 3 = the room's palette 3,
   * 2 = palette 2 in `color`. */
  attrs: [number, number, number, number];
  color: number;
}

/**
 * Menu icons as pickups (menu palette 3 -> 3, others -> 2 recoloured: pal0 $15, pal1 $2A, pal2 $21). No Machine Gun:
 * item $04 in any pickup is treated as the Destroyer's gun (spawns only after the right YES, 0F:$F5CC).
 */
const ICONS: Partial<Record<Item, Icon>> = {
  pendant: { tiles: 0x20d70, attrs: [3, 3, 3, 3], color: 0x21 },
  helmet: { tiles: 0x20db0, attrs: [2, 3, 2, 3], color: 0x2a },
  vest: { tiles: 0x20df0, attrs: [3, 2, 3, 2], color: 0x21 },
  rocket: { tiles: 0x20e70, attrs: [3, 3, 2, 3], color: 0x15 },
  wide: { tiles: 0x20eb0, attrs: [2, 3, 2, 2], color: 0x2a },
  machine: { tiles: 0x20ef0, attrs: [3, 3, 2, 3], color: 0x21 }, // the Destroyer rooms' vanilla gun (record $4E)
  threeway: { tiles: 0x20f30, attrs: [2, 3, 2, 2], color: 0x15 },
  flare: { tiles: 0x20f70, attrs: [2, 2, 2, 2], color: 0x15 },
  pills: { tiles: 0x20fb0, attrs: [3, 2, 3, 2], color: 0x2a },
  permit: { tiles: 0x20ff0, permit: true, attrs: [3, 3, 2, 2], color: 0x21 },
  boots: { tiles: 0x24630, attrs: [2, 2, 2, 2], color: 0x21 },
  rapid: { tiles: 0x24670, attrs: [2, 2, 2, 2], color: 0x21 },
  alpha: { tiles: 0x246b0, attrs: [2, 2, 2, 2], color: 0x15 },
  beta: { tiles: 0x246b0, attrs: [2, 2, 2, 2], color: 0x2a },
  gamma: { tiles: 0x246b0, attrs: [2, 2, 2, 2], color: 0x21 },
  delta: { tiles: 0x246b0, attrs: [3, 3, 3, 3], color: 0x21 },
  iff: { tiles: 0x20ff0, permit: true, attrs: [2, 2, 2, 2], color: 0x2a }, // a green Permit card
  flak: { tiles: 0x20ff0, permit: true, attrs: [2, 2, 2, 2], color: 0x15 }, // a red Permit card
};

export const canBePickup = (item: Item) => item in ICONS;

function expectBytes(rom: Uint8Array, at: number, bytes: number[], what: string) {
  if (bytes.some((b, i) => rom[at + i] !== b)) throw new Error(`pickups: unexpected bytes at ${what}`);
}

/** CPU address (bank 6-9) of a file offset, as a CHR record's source: lo, hi | (bank - 6) << 6. */
/** A CHR copy record's source bytes for tile data at `file` (banks 6-9). */
export function chrSource(file: number): [number, number] {
  const bank = (file - 0x10) >> 14, cpu = 0x8000 + ((file - 0x10) & 0x3fff);
  if (bank < 6 || bank > 9) throw new Error('pickups: icon tiles outside banks 6-9');
  return [cpu & 0xff, ((cpu >> 8) & 0x3f) | ((bank - 6) << 6)];
}

const word = (rom: Uint8Array, at: number) => rom[at] | (rom[at + 1] << 8);

/**
 * Put `items` (room -> item) into building rooms from PICKUP_ROOMS. Rooms not listed keep their vanilla contents;
 * room $44 listed with 'oneup' stays the vanilla 1UP.
 */
export function placeBuildingItems(rom: Uint8Array, items: Map<number, Item>) {
  const placed = [...items].filter(([room, item]) => !(room === 0x44 && item === 'oneup'));
  if (!placed.length) return;
  // The Destroyer rooms are marked by DESTROYER_MARK whenever this runs (so a Machine Gun elsewhere is a plain pickup);
  // not given, they keep the vanilla Machine Gun under the Destroyer rules.
  if (!placed.some(([room]) => (DESTROYER_ROOMS as readonly number[]).includes(room))) {
    for (const room of DESTROYER_ROOMS) placed.push([room, 'machine']);
  }
  const destroyer = placed.filter(([room]) => (DESTROYER_ROOMS as readonly number[]).includes(room));
  if (destroyer.length && (destroyer.length !== 2 || destroyer[0][1] !== destroyer[1][1])) throw new Error('pickups: both Destroyer rooms hold one item');
  for (const [room, item] of placed) {
    if (![...PICKUP_ROOMS, ...DESTROYER_ROOMS].includes(room as (typeof PICKUP_ROOMS)[number])) throw new Error(`pickups: room $${room.toString(16)} can't hold an item`);
    if (!ICONS[item]) throw new Error(`pickups: no pickup icon for ${item}`);
  }

  // --- loader: id $7F builds its record from the per-room icon table ---
  const table: number[] = new Array(28).fill(0); // (src lo, src hi) per room $37-$44
  for (const [room, item] of placed) table.splice(2 * (room - 0x37), 2, ...chrSource(ICONS[item]!.tiles));
  installLoaderHelper(rom, table);

  // --- spawn check: vanilla `CMP #$04 / BEQ destroyer / BMI none` tests the compare, so items $00-$03 (Rocket Launcher,
  // Wide Cannon) never spawn. Test the raw value first: `BMI none / CMP #$04 / BEQ destroyer` (0F:$F5CC). ---
  expectBytes(rom, off0F(0xf5cc), [0xc9, 0x04, 0xf0, 0x1c, 0x30, 0x25], 'pickup spawn check');
  rom.set([0x30, 0x29, 0xc9, DESTROYER_MARK, 0xf0, 0x1a], off0F(0xf5cc));
  destroyerPickups(rom, destroyer[0][1]);

  // --- spare id $17: the Permit icon's second half ($50/$51, file 0x245D0) -> tiles $C7/$C8 ---
  const permitRecord = off03(CHR_RECORDS + 5 * PERMIT_ID);
  rom.set([...chrSource(0x245d0), 0x0c, 0x70, 0x02], permitRecord);

  // --- per-room CHR lists: the room's list + $7F (+ $17), shared between rooms with the same list ---
  expectBytes(rom, off03(LIST_SPACE), new Array(LIST_END - LIST_SPACE).fill(0xff), 'free space 03:$B84B');
  const lists = new Map<string, number>();
  let listAt = LIST_SPACE;
  for (const [room, item] of placed) {
    const ptr = off03(CHR_LISTS + 2 * room);
    const ids: number[] = [];
    for (let a = off03(word(rom, ptr)); rom[a] < 0x80; a++) ids.push(rom[a]);
    const list = [...ids, 0x7f, ...(ICONS[item]!.permit ? [PERMIT_ID] : []), 0xff];
    const key = list.join(',');
    if (!lists.has(key)) {
      if (listAt + list.length > LIST_END) throw new Error('pickups: no room for CHR lists');
      rom.set(list, off03(listAt));
      lists.set(key, listAt);
      listAt += list.length;
    }
    rom.set([lists.get(key)! & 0xff, lists.get(key)! >> 8], ptr);
  }

  // --- item, metasprite, palette, object ---
  let palAt = PAL_SPACE;
  for (const [room, item] of placed) {
    const icon = ICONS[item]!;
    const idx = room - 0x37;
    rom[off0F(ITEM_TABLE) + idx] = (DESTROYER_ROOMS as readonly number[]).includes(room) ? DESTROYER_MARK : ITEMS[item].inventory;
    const slot = ANIM_SLOT[room];
    if (slot === 0xbf90) expectBytes(rom, off0A(slot), new Array(16).fill(0xff), 'free space 0A:$BF90');
    // Room $44's palette 3 is red (its enemy and 1UP use it), so there the pickup draws only with palette 2: orange for
    // all-orange icons (δ, Pendant), else the icon's main colour (two-colour icons lose their orange part).
    const ownPal3 = room !== 0x44;
    const allOrange = icon.attrs.every((a) => a === 3);
    const [tl, tr, bl, br] = ownPal3 ? icon.attrs : [2, 2, 2, 2];
    const color = ownPal3 || !allOrange ? icon.color : ORANGE;
    rom.set([4, 0xc5, 0xf8, 0x00, tl, 0xc7, 0xf8, 0x08, tr, 0xc6, 0x00, 0x00, bl, 0xc8, 0x00, 0x08, br], off0A(slot));
    rom.set([slot & 0xff, slot >> 8], off0F(ANIM_PTRS) + 2 * idx);
    // palette 2 = [$0F, $30, color, $0F] in a copy of the room's block
    const palPtr = PAL_PTRS + 2 * room;
    const block = off01(word(rom, palPtr));
    if (rom[block + 0x1a] !== color || rom[block + 0x19] !== 0x30) {
      if (palAt + 32 > PAL_END) throw new Error('pickups: no room for palette blocks');
      expectBytes(rom, off01(palAt), new Array(32).fill(0xff), 'free space 01:$9D00');
      rom.set(rom.slice(block, block + 32), off01(palAt));
      rom.set([0x0f, 0x30, color, 0x0f], off01(palAt) + 0x18);
      rom.set([palAt & 0xff, palAt >> 8], palPtr);
      palAt += 32;
    }
    if (room === 0x44) {
      const list = off03(word(rom, OBJECT_PTRS + 2 * room));
      expectBytes(rom, list, [0x73], 'room $44 1UP object');
      rom[list] = 0x79; // the 1UP becomes the item pickup, same spot
    }
  }
}

/**
 * The Destroyer rooms pay out `item` instead of the Machine Gun. Vanilla: the pickup spawns while `$04C5` (set by the
 * Destroyers' YES answers; real = 1, impostor = 2, cleared on map entry) is 1-3, and touching it gives the gun only if
 * it's 1, then sets it to $FF.
 * - Spawn (0F:$F5EC): only when `$04C5` = 1 (`BEQ/BMI none` -> `CMP #1 / BNE none`), and the "already owned" check looks
 *   at the item (`LDY #$04` -> its inventory offset).
 * - Touch (0F:$F630/$F634 branch to $F649, four free bytes before the vanilla $F64D block): `LDA $04C5 / LSR / BNE
 *   skip` (only 1 shifts to 0; 2 and 3 to 1), give the item, `$04C5 = $FF`, then the normal pickup's sound and exit
 *   ($F641). The Flak Map stores to its own flag (patches.ts `addFlakMap`).
 */
function destroyerPickups(rom: Uint8Array, item: Item) {
  const SPAWN = off0F(0xf5ec), TOUCH = off0F(0xf62d), BLOCK = off0F(0xf649);
  expectBytes(rom, SPAWN, [0xad, 0xc5, 0x04, 0xf0, 0x06, 0x30, 0x04, 0xa0, 0x04], 'Destroyer pickup spawn');
  expectBytes(rom, TOUCH, [0xbc, 0x80, 0x06, 0xc0, 0x0a, 0xf0, 0x19, 0xc0, 0x0b, 0xf0, 0x15], 'Destroyer pickup touch');
  expectBytes(rom, BLOCK, [0x00, 0x00, 0x00, 0x00, 0xad, 0xc5, 0x04, 0xc9, 0x01, 0xd0, 0x03, 0xee, 0xce, 0x04, 0xa9, 0xff,
    0x8d, 0xc5, 0x04, 0x4c, 0xca, 0xd6], 'Destroyer pickup touch block');
  const offset = ITEMS[item].inventory;
  rom.set([0xad, 0xc5, 0x04, 0xc9, 0x01, 0xd0, 0x04, 0xa0, offset], SPAWN);
  rom[TOUCH + 6] = 0x15; rom[TOUCH + 10] = 0x11; // BEQ $F649
  const give = item === 'flak'
    ? [0xa9, 0x01, 0x8d, 0xd3, 0x01, 0xea, 0xea] //   LDA #1 / STA $01D3 (the Flak Map's flag)
    : [0xa0, offset, 0xa9, 0x01, 0x99, 0xca, 0x04]; // LDY #offset / LDA #1 / STA $04CA,Y
  rom.set([
    0xad, 0xc5, 0x04, 0x4a, 0xd0, 0x07, // LDA $04C5 / LSR / BNE skip
    ...give,
    0xa9, 0xff, 0x8d, 0xc5, 0x04, //       skip: LDA #$FF / STA $04C5
    0x30, 0xe4, //                         BMI $F641 (pickup sound, exit)
    0xea, 0xea,
  ], BLOCK);
}

/** Sprite palette of the underground-passage stage (room $15) by an icon's main colour: 1 white/green, 2 pink/red,
 * 3 pink/blue (0 is pink/brown, too dark on the floor; no orange). */
const PASSAGE_PAL: Record<number, number> = { 0x2a: 1, 0x15: 2, 0x21: 3 };
const PASSAGE_SPAWN = 0x34b84; // 0D:$8B73 `LDA $04D3` operand: the pickup spawns while this is 0
const PASSAGE_GIVE = 0x3507a; // 0D:$9067 `STA $04D3` operand: touching it sets this to 1
const PASSAGE_ANIM = 0xba06; // 0A: the helmet's metasprite (only the type-$0E handler uses it)
/** 03: the passage stage's CHR list, in free $B6C5-$B6CF (a byte of margin each side; patches.ts topDownDrops adds to it). */
export const PASSAGE_LIST = 0xb6c6, PASSAGE_LIST_END = 0xb6cf;
/** CHR record ids no list uses ($45; $59, $5B, $5C extra records), one per icon tile. */
const PASSAGE_IDS = [0x45, EXTRA_FIRST, EXTRA_FIRST + 2, EXTRA_FIRST + 3];

/** File offsets of the tiles the passage pickup loads into $F2-$F5 for `item`: TL, BL, TR, BR (8x16 columns). */
export function passageTileSources(item: Item): number[] {
  const icon = ICONS[item]!;
  const top = icon.tiles, bottom = icon.permit ? 0x245d0 : icon.tiles + 32;
  return [top, bottom, top + 16, bottom + 16];
}

/**
 * Put `item` in the underground-passage stage instead of the Helmet (docs/rom-notes.md#top-down-stages). The pickup (object
 * type $0E) spawns while the item's flag is 0 and sets it to 1 on touch; the stage keeps replaying while the item is
 * missed. Its art: the item's menu icon, loaded into sprite tiles $F2-$F5 (unused there) by two spare CHR records
 * appended to the room's list, drawn as two 8x16 columns in the stage palette nearest its menu colour.
 */
export function placePassageItem(rom: Uint8Array, item: Item) {
  if (item === 'helmet') return;
  const icon = ICONS[item];
  if (!icon) throw new Error(`pickups: no pickup icon for ${item}`);
  const flag = item === 'flak' ? 0x01d3 : 0x04ca + ITEMS[item].inventory;
  expectBytes(rom, PASSAGE_SPAWN - 1, [0xad, 0xd3, 0x04, 0xd0], 'passage pickup spawn check');
  expectBytes(rom, PASSAGE_GIVE - 3, [0xa9, 0x01, 0x8d, 0xd3, 0x04], 'passage pickup give');
  rom.set([flag & 0xff, flag >> 8], PASSAGE_SPAWN);
  rom.set([flag & 0xff, flag >> 8], PASSAGE_GIVE);

  // CHR: the room's list (40 41) + the icon's records
  const ptr = off03(CHR_LISTS + 2 * 0x15);
  expectBytes(rom, off03(word(rom, ptr)), [0x40, 0x41, 0xff], 'passage stage CHR list');
  expectBytes(rom, off03(0xb6c5), new Array(11).fill(0xff), 'free space 03:$B6C5');
  // The stage draws 8x16 sprites (a column = an even tile over the next one), but icons are stored row by row (TL, TR,
  // BL, BR), so each tile gets its own record: TL -> $F2, BL -> $F3, TR -> $F4, BR -> $F5. (A Permit-shaped icon's
  // bottom row is the Permit's second half.)
  passageTileSources(item).forEach((src, i) => setChrRecord(rom, PASSAGE_IDS[i], [...chrSource(src), 0x0f, 0x20 + 0x10 * i, 0x01]));
  rom.set([0x40, 0x41, ...PASSAGE_IDS, 0xff], off03(PASSAGE_LIST));
  rom.set([PASSAGE_LIST & 0xff, PASSAGE_LIST >> 8], ptr);

  // metasprite: [count] then [tile, x, y, attr] per 8x16 sprite
  expectBytes(rom, off0A(PASSAGE_ANIM), [0x02, 0xb8, 0xf8, 0xf8, 0x01, 0xb8, 0x00, 0xf8, 0x41], 'passage helmet metasprite');
  // one palette for the whole icon (two-tone icons read better than with a brown half); all-orange icons go red
  const pal = icon.attrs.every((a) => a === 3) ? 2 : PASSAGE_PAL[icon.color];
  // (the stage draws this object mirrored, columns swapped and each flipped, which the symmetric helmet hid: so the
  // icon goes in mirrored, and comes out the right way round)
  rom.set([0x02, 0xf4, 0xf8, 0xf8, pal | 0x40, 0xf2, 0x00, 0xf8, pal | 0x40], off0A(PASSAGE_ANIM));
}

/** The area-clear screen's name for `item` (its vanilla name block, or CLEAR_NAMES), spaces collapsed. */
export function clearName(rom: Uint8Array, item: Item): string {
  const extra = CLEAR_NAMES[item]?.text;
  if (extra) return extra;
  const at = ITEMS[item].clearText;
  if (at === undefined) return ITEMS[item].name.toUpperCase(); // (the Machine Gun has none)
  const bytes: number[] = [];
  for (let a = off0A(0xb17b + at); rom[a] !== 0xff; a++) bytes.push(rom[a]);
  return decodeText(bytes).replace(/ +/g, ' ').trim();
}

/** Ladd's line for a building pickup: the area-clear wording. */
export function pickupLine(rom: Uint8Array, item: Item): Message {
  return { header: LADD, text: wrap(`WE'VE OBTAINED\n${clearName(rom, item)}`) };
}

// Message header: Ladd's portrait in the in-room box style (bits 7-6 = 0, as the talkers' lines). #108's $43 (Joe's
// rescue scene) is another style that, in a building, prints the text into the wall tiles' patterns (VERIFIED).
const LADD = 0x03;
/** Message Y the pickup puts in talk mode: #127 "WE'VE OBTAINED", shown only if a room has no line of its own. */
const PICKUP_MSG_Y = ALT_Y;

/**
 * Touching a building pickup opens the talk box (roomtalk.ts shows the room's line). The touch code (0F:$F62D-$F65E,
 * after placeBuildingItems, which may have reworked the Destroyer rooms) is rewritten, 5 bytes shorter: the Destroyer
 * rooms are found by their item-table mark ($04 vanilla, DESTROYER_MARK reworked) instead of two room compares, and
 * after the give and the pickup sound, `LDA #y / JSR $D78A` (0F:$E6C4: talk mode, message Y = A, as the escape
 * cyborg). A Destroyer room gives only when `$04C5` was 1 (the real Destroyer's YES), else it just goes.
 */
export function addPickupMessages(rom: Uint8Array) {
  const AT = off0F(0xf62d), END = off0F(0xf65f);
  expectBytes(rom, AT, [0xbc, 0x80, 0x06, 0xc0, 0x0a, 0xf0], 'pickup touch');
  expectBytes(rom, off0F(0xf638), [0xb9, 0xfa, 0xf5, 0xa8, 0xa9, 0x01], 'pickup touch give');
  expectBytes(rom, off0F(0xf641), [0xa0, 0x34, 0x20, 0x54, 0xd7, 0x4c, 0xca, 0xd6], 'pickup touch sound');
  const give = [...rom.subarray(off0F(0xf63e), off0F(0xf641))]; // STA $04CA,Y, or the Flak Map's JSR $C694
  const mark = rom[off0F(ITEM_TABLE) + 0x0a];
  let destroyerGive: number[];
  if (mark === DESTROYER_MARK) {
    destroyerGive = [...rom.subarray(off0F(0xf649 + 6), off0F(0xf649 + 13))]; // destroyerPickups' give (A = 1 after)
  } else {
    if (mark !== 0x04) throw new Error('pickups: unexpected Destroyer room item');
    expectBytes(rom, off0F(0xf64d), [0xad, 0xc5, 0x04, 0xc9, 0x01, 0xd0, 0x03, 0xee, 0xce, 0x04], 'Destroyer pickup touch');
    destroyerGive = [0xee, 0xce, 0x04]; // INC $04CE (the Machine Gun; nonzero after)
  }
  const code = assemble(0xf62d, [
    0xbc, 0x80, 0x06, //             LDY $0680,X (room - $37)
    0xb9, 0xfa, 0xf5, //             LDA $F5FA,Y
    0xc9, mark, { rel: 0xf0, to: 'destroyer' }, // CMP #mark / BEQ destroyer
    0xa8, 0xa9, 0x01, ...give, //    TAY / LDA #1 / give
    { label: 'show' },
    0xa0, 0x34, 0x20, 0x54, 0xd7, // LDY #$34 / JSR $D754 (pickup sound)
    0xa9, PICKUP_MSG_Y, 0x20, 0x8a, 0xd7, // LDA #y / JSR $D78A (talk mode)
    { label: 'exit' },
    0x4c, 0xca, 0xd6, //             JMP $D6CA (the pickup goes)
    { label: 'destroyer' },
    0xac, 0xc5, 0x04, //             LDY $04C5
    0xa9, 0xff, 0x8d, 0xc5, 0x04, // LDA #$FF / STA $04C5
    0x88, { rel: 0xd0, to: 'exit' }, // DEY / BNE exit (not the real Destroyer's YES)
    ...destroyerGive,
    { rel: 0xd0, to: 'show' }, //    BNE show
  ]);
  if (AT + code.length > END) throw new Error('pickups: touch code too big');
  rom.set([...code, ...new Array(END - AT - code.length).fill(0xea)], AT);
}
