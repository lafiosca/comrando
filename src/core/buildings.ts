// Neutral-zone building shuffle (docs/design.md#buildings): which interior sits behind which door, and what the people
// standing at the doors say about it. See docs/rom-notes.md#buildings and #building-people.

import {
  BUILDING_ROOMS,
  setBuildingDoors,
  setInsideTalkersByRoom,
  vanillaDoor,
  type Door,
} from './patches/buildingdoors.ts';
import type { Rng } from './rng.ts';
import type { SpoilerBuilding } from './spoiler.ts';
import { messageForY, wrap } from './text.ts';
import { areaList, areaWord } from './story.ts';
import { DESTROYER_ROOMS, ITEM_ROOMS, ITEMS, PASSAGE_ROOM, type Item, zoneNode } from './world.ts';

/** Rooms worth a trip: the five pickup rooms and the interrogation room. Each zone with doors gets one. */
const BIG_ROOMS = [0x38, 0x39, 0x3c, 0x3d, 0x44, PASSAGE_ROOM];
/** The pickup rooms that always hold a real item (NZ19 B's may keep its 1UP). */
const ITEM_ONLY_ROOMS = [0x38, 0x39, 0x3c, 0x3d];
const NZ15 = 0x0e;

/**
 * Random door for every building; the two Destroyer rooms stay behind NZ18's doors (paired with the men outside).
 * Balanced: each of the six zones with doors gets one big room (BIG_ROOMS) and one small one (bullets, a 1UP, an
 * informer). The room behind NZ15's barrier (door B) always holds a real item, and the interrogation room stays in
 * a zone whose layout sits east (`eastZones`, zone map nodes 13-19 by layout): the hidden passages are a shortcut,
 * not a free way east.
 */
export function shuffleBuildings(rng: Rng, eastZones: number[]): Map<number, Door> {
  const zones = [0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x12];
  const big = new Map<number, number>(); // zone room -> big room
  const passageZones = zones.filter((z) => z !== NZ15 && eastZones.includes(zoneNode(z)));
  big.set(rng.pick(passageZones), PASSAGE_ROOM);
  const nz15Room = rng.pick(ITEM_ONLY_ROOMS);
  big.set(NZ15, nz15Room);
  const rest = rng.shuffle(BIG_ROOMS.filter((b) => b !== PASSAGE_ROOM && b !== nz15Room));
  for (const z of zones) if (!big.has(z)) big.set(z, rest.pop()!);
  const small = rng.shuffle(BUILDING_ROOMS.filter((b) => !BIG_ROOMS.includes(b) && !DESTROYER_ROOMS.includes(b)));
  const out = new Map<number, Door>();
  zones.forEach((zone, i) => {
    const bigSlot = zone === NZ15 ? 1 : rng.pick([0, 1]);
    out.set(big.get(zone)!, { zone, slot: bigSlot });
    out.set(small[i], { zone, slot: 1 - bigSlot });
  });
  for (const b of DESTROYER_ROOMS) out.set(b, vanillaDoor(b));
  return out;
}

export const vanillaBuildings = () => new Map(BUILDING_ROOMS.map((b) => [b, vanillaDoor(b)]));

/** What a door-side person says about the building behind them. */
function contentsLine(room: number, items: Map<number, Item>): string {
  const item = items.get(room);
  if (item) return `THERE'S ${ITEMS[item].name} INSIDE.`;
  return (
    {
      0x37: "THERE'S A BULLET INSIDE.",
      0x3a: 'THERE ARE PLENTY OF BULLETS INSIDE.',
      0x3b: "THERE'S A 1UP INSIDE.",
      0x3e: 'SOMEONE INSIDE WANTS TO TALK TO YOU.',
      0x3f: 'PLEASE COME IN.',
      0x40: 'SOMEONE INSIDE HAS NEWS FOR YOU.',
      0x43: 'THERE ARE SOME BULLETS INSIDE.',
      0x44: "THERE'S A 1UP INSIDE. BE CAREFUL.",
    } as Record<number, string>
  )[room]!;
}

/**
 * Apply a building layout: door tables, inside talkers keyed by room, and the four door-side lines that describe
 * what's behind their door (NZ13 B #21, NZ14 A #61, NZ16 A #39, NZ17 A #73). `items` is what each item room holds;
 * `flareAreas` are the map numbers now showing the dark areas (vanilla 4). With `doorsShuffled` false only the lines are
 * produced (building items moved, doors vanilla). `addenda` (message Y -> sentence) adds a hint after a talker's
 * contents line. Returns the message replacements for the caller to
 * write (one `writeMessages` call per seed).
 */
export function applyBuildings(
  rom: Uint8Array,
  doors: Map<number, Door>,
  items: Map<number, Item>,
  flareAreas: readonly number[] = [4],
  doorsShuffled = true,
  addenda: Map<number, string> = new Map(),
): Map<number, string> {
  if (doorsShuffled) {
    setBuildingDoors(rom, doors);
    setInsideTalkersByRoom(rom);
  }
  const behind = (zone: number, slot: number) => [...doors].find(([, d]) => d.zone === zone && d.slot === slot)![0];
  const item = (room: number) => items.get(room);
  const lines = new Map<number, string>();
  // (`shorter`: the line without its last sentence, if the addendum makes it too long for a message)
  const add = (y: number, text: string, shorter?: string) => {
    const full = (t: string) => wrap(addenda.has(y) ? `${t}\n${addenda.get(y)}` : t);
    lines.set(messageForY(y), shorter && full(text).length > 255 ? full(shorter) : full(text));
  };

  const nz13b = behind(0x0c, 1); // vanilla: the Flare room
  const flare = `WELCOME,\nMY FRIEND.\nWE'VE PREPARED SOME FLARE BOMBS FOR YOU.\nYOU WILL NEED THEM IN ${areaWord(areaList(flareAreas, (n) => n, true))}.`; // (our line: an Oxford comma)
  if (item(nz13b) === 'flare')
    add(0x26, `${flare}\nPUSH START BUTTON TO USE THEM.`, flare); // (three dark areas and a hint)
  else add(0x26, `WELCOME,\nMY FRIEND.\n${contentsLine(nz13b, items)}`);
  const nz14a = behind(0x0d, 0); // vanilla: the γ room
  add(0x76, item(nz14a) ? `I HAVE ${ITEMS[item(nz14a)!].name} YOU WANT.` : contentsLine(nz14a, items));
  const nz16a = behind(0x0f, 0); // vanilla: the β room
  add(0x4a, `WELCOME.\n${contentsLine(nz16a, items)}`);
  const nz17a = behind(0x10, 0); // vanilla: the passage room
  add(
    0x8e,
    nz17a === PASSAGE_ROOM
      ? 'WE WERE WAITING FOR YOU.\nPLEASE COME IN.'
      : `WE WERE WAITING FOR YOU.\n${contentsLine(nz17a, items)}`,
  );
  return lines;
}

/** The spoiler's buildings: each door, by map number and layout, and what's behind it. */
export function buildingSpoiler(
  doors: Map<number, Door>,
  items: Map<number, Item>,
  spotOf: (id: number) => number,
): SpoilerBuilding[] {
  return [...doors]
    .sort(([, a], [, b]) => a.zone - b.zone || a.slot - b.slot)
    .map(([room, d]) => ({
      area: spotOf(zoneNode(d.zone)),
      layout: zoneNode(d.zone),
      door: d.slot ? 'B' : 'A',
      room,
      ...roomContents(room, items),
    }));
}

/** What a building room holds: the seed's item, else its ammo or 1UP, or who's inside. */
export function roomContents(
  room: number,
  items: Map<number, Item>,
): Pick<SpoilerBuilding, 'contents' | 'item' | 'bullets'> {
  const item = items.get(room);
  if (item) return { contents: 'item', item };
  return (
    {
      0x37: { contents: 'bullets', bullets: 1 },
      0x3a: { contents: 'bullets', bullets: 11 },
      0x3b: { contents: 'item', item: 'oneup' },
      0x3e: { contents: 'informer' },
      0x3f: { contents: 'interrogation' },
      0x40: { contents: 'informer' },
      0x41: { contents: 'destroyer' },
      0x42: { contents: 'destroyer' },
      0x43: { contents: 'bullets', bullets: 4 },
      0x44: { contents: 'item', item: 'oneup' },
    } as Record<number, Pick<SpoilerBuilding, 'contents' | 'item' | 'bullets'>>
  )[room];
}

export const vanillaItemRooms = () => new Map(Object.entries(ITEM_ROOMS).map(([r, i]) => [Number(r), i]));
