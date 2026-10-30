# Architecture

Bionic Comrando is a randomizer for NES Bionic Commando (USA). It is plain TypeScript: a core library that turns a
ROM and a seed code into a patched ROM and a spoiler, a static web page around it, and a command-line tool. Nothing
runs on a server; the player's ROM never leaves their browser.

```
src/
  core/          the generator: no DOM, runs unchanged in the browser and in Node 24 (type stripping)
    patches/     ROM patches by game system
  ui/            the web page's components (route view, simulator, color picker, …)
  main.ts        the web page's wiring
  cli.ts         the command-line generator
test/            unit tests and emulator tests (jsnes)
docs/            this file, ROM notes, the spoiler format
```

## Determinism

A seed code carries every gameplay option and a random seed (`settings.ts`). The same generator version and seed code
always make the same game, byte for byte, in the browser or the CLI. Each feature draws from its own named random
stream (`stream('zones')`, `stream('hints')`, …) so that adding a feature doesn't reshuffle the others. Cosmetic
options (colors) are not in the seed code and use a separate random stream; they never affect gameplay.

Releases are versioned (`GENERATOR_VERSION` in `generate.ts`). A minor or major version may change what a seed code
makes, which is why the site keeps every released version online. A patch version never does (only the page around
it changes): the site sends a link or page of an older patch to the newest patch of its line (`main.ts`).

## From seed code to ROM

`generate(rom, seedCode)` in `core/generate.ts` runs these stages in order:

1. **Plan** (`planSeed`): parse the seed code, then draw a layout and a placement until one is beatable and meets the
   options (logic depth, late Rocket Launcher, …), and pick the hints. No ROM is needed for this.
   - `zones.ts`: which area and neutral-zone layout sits at each map number.
   - `buildings.ts`: which building interior is behind each zone door.
   - `comms.ts`: which communicator works in each area.
   - `world.ts`: the items, the locations, and what each location requires.
   - `logic.ts`: the reachability sweep and the assumed fill that places items.
   - `hints.ts`: a simulated "guided player" who only goes where a hint has pointed them. Each hint slot is filled
     when that player first reads it, so every seed has a chain of clues from the briefing to the end.
     `hintdata.ts` holds the hint slots and what a hint can say; `route.ts` replays the finished hints into the
     intended route.
2. **Place items**: area-clear rewards, building pickups, the passage item, Super Joe.
3. **Gameplay patches** (`patches/`): weapons, darkness, door locks, top-down stages, turrets, and so on.
4. **Roads and the map**: region gates, the Flak Map, travel speed, map markers and gate display, the new-game state,
   then the map layout itself.
5. **Text**: every changed message is collected, then the dialogue bank is repacked in one go (`text.ts`). Story text
   (`story.ts`), Destroyers, hints, buildings, Nonsense lines, typo fixes, boss dialogue and credits all go through
   this. If a seed's random lines overflow the bank, those lines are drawn again from the next stream.
6. **Presentation**: the title logo and the palettes (cosmetics).
7. **Results**: the spoiler (`spoiler.ts`), the oracle route (`oracle.ts`), and the simulator's data (`sim.ts`).

## How a patch works

Every patch knows the exact bytes it expects at each address and checks them before writing
(`patches/rom.ts` `expect`). On an unexpected ROM it throws instead of corrupting it. New code goes into ROM space
the game never uses; [rom-notes.md](rom-notes.md) records which.

Most patches are small 6502 routines written as byte arrays, with the assembly in a comment on each line. Longer ones
use `asm.ts`, which resolves labels and branch offsets:

```ts
const code = assemble(0x9fac, [
  0xc0, 0x03, { rel: 0xf0, to: 'mg' }, // CPY #3 / BEQ mg
  …
  { label: 'mg' },
  …
]);
```

Addresses are written as `bank:$address` (e.g. `0D:$B94A`). The file offset is `0x10 + bank * 0x4000 + (address - $8000)`.

## The spoiler and the route

The spoiler is data, not prose (`spoiler.ts`): places are `{ area, layout }`, items are ids, and the routes are lists
of visits and steps with structured reasons. `routetext.ts` turns a route into English for the page. Other renderings
or translations can work from the same data.

There are two routes:
- The **intended route** (`route.ts`): what a player following the hints does.
- The **oracle route** (`oracle.ts`): a short way through for someone who knows every placement.

## The simulator

`sim.ts` turns a generated seed into places and the actions possible at each, with a fog-of-war state: only what the
player would know. `ui/simulator.ts` draws it with the game's own map screen, item icons and portraits, all read
from the player's ROM (`mapart.ts`, `icons.ts`, `portraits.ts`).

## Tests

`yarn test:fast` runs the unit tests. `yarn test:emu` runs the emulator tests, which boot patched ROMs in jsnes and
check behavior in the game itself. Both need a ROM: set `BC_ROM=/path/to/rom.nes` (or .zip).
