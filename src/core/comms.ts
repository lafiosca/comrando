// Which communicator works in which area layout (docs/design.md#communicators). The game keys it by layout ($4D) in a 13-byte table;
// COMMUNICATE and WIRETAP both check it (0D:$AC2E), and the comm-locked doors (O1, O4, O8) open on the message id
// shown, so they follow the table too.

import type { Rng } from './rng.ts';
import { COMM_ITEMS, VANILLA_COMMS, type Item } from './world.ts';

/** 0D:$AC83, nodes 0-12: comm index (0 α, 1 β, 2 γ, 3 δ). */
const COMM_TABLE = 0x36c93;

/** Comm per layout 1-12 (index 0 unused). */
export type CommAssignment = readonly Item[];

/**
 * Random assignment: three layouts per comm, O1 keeps α (the starting comm, which the briefing sends you to use), and
 * O6 and O7 (no working comm room) never share a comm, so the working rooms split 3-3-2-2, never 3-3-3-1. α's other two
 * layouts always have a usable comm room (not 6, 7 or 12), and at least one of them is in `near` (layouts on the
 * start side of the map, as in vanilla's α 1, 4, 5), so α's rooms can carry the first clues.
 */
export function assignComms(rng: Rng, near: readonly number[] = [1, 2, 3, 4, 5, 6]): CommAssignment {
  for (;;) {
    const rest = rng.shuffle([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const groups = [[1, rest[0], rest[1]], rest.slice(2, 5), rest.slice(5, 8), rest.slice(8, 11)];
    if (
      groups.some((g) => g.includes(6) && g.includes(7)) ||
      groups[0].some((n) => [6, 7, 12].includes(n)) ||
      !groups[0].slice(1).some((n) => near.includes(n))
    )
      continue;
    const out: Item[] = ['alpha'];
    groups.forEach((g, i) => g.forEach((n) => (out[n] = COMM_ITEMS[i])));
    return out;
  }
}

export const vanillaComms = (): CommAssignment => VANILLA_COMMS;

export function applyComms(rom: Uint8Array, comms: CommAssignment) {
  for (let n = 1; n <= 12; n++) {
    const was = rom[COMM_TABLE + n];
    if (was !== COMM_ITEMS.indexOf(VANILLA_COMMS[n])) throw new Error('comms: unexpected comm table');
    rom[COMM_TABLE + n] = COMM_ITEMS.indexOf(comms[n]);
  }
}
