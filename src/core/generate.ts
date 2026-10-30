// Seed generation entry point shared by the web app and the CLI.

import { applyBuildings, buildingSpoiler, shuffleBuildings, vanillaBuildings, vanillaItemRooms } from './buildings.ts';
import { normalizeCosmetics, type Cosmetics } from './cosmetics.ts';
import { deepen, feasible, fill, isCompletable, requiredItems, sweep, type Placement } from './logic.ts';
import { applyEnemyPalette, applyPlayerPalette, enemyColorValue, UNIFORM_COLORS } from './palette.ts';
import { FLAG_JOE, flagAreaCleared, placeJoe, setArea12Condition } from './patches/area12.ts';
import { darkAreas, EXTRA_DARK_LAYOUTS, trueDark } from './patches/dark.ts';
import {
  applyDoorLocks,
  area12CommLock,
  area12FlagRows,
  area12LockRows,
  BOSS_21,
  commFlagSetter,
  commLockFlagRows,
  commLockRows,
  EXTRA_COMM_LOCKS,
} from './patches/locks.ts';
import { oneBriefingMessage, skipRescueSpeech, oneLineWiretaps, oneRescueLine } from './patches/messages.ts';
import { setLives, setNewGameState, unlimitedContinues } from './patches/newgame.ts';
import { fixCommPageBoxes, setAreaClearReward } from './patches/rewards.ts';
import {
  addFlakMap,
  disableTrucks,
  fixPassageGate,
  FLAK_FLAG,
  removeRoadGates,
  setMapSpeed,
  setRoad10Gate,
  setRoadGate,
} from './patches/roads.ts';
import { type Eagles, eagleOneUps, noEagles, topDownFire, topDownDrops } from './patches/topdown.ts';
import { destructibleTurrets } from './patches/turrets.ts';
import { fixRapidFire, machineGunAuto, setBarrierWeapons, SHOT_TYPE } from './patches/weapons.ts';
import { verifyRom } from './rom.ts';
import { randomSeed, Rng } from './rng.ts';
import {
  conflicts,
  GAMEPLAY_SCHEMA,
  makeSeedCode,
  normalizeSettings,
  parseSeedCode,
  runStyle,
  type Settings,
  VANILLA_SETTINGS,
} from './settings.ts';
import { CREDITS_HEADER, CREDITS_Y, creditsText, setLetterWait } from './credits.ts';
import { finalScreen, FONT_COPY_SIZE } from './finalscreen.ts';
import { applyMapMarkers, VISITED } from './mapmarkers.ts';
import { applyGateDisplay } from './gatedisplay.ts';
import { applyComms, assignComms, type CommAssignment, vanillaComms } from './comms.ts';
import { makeHints } from './hints.ts';
import type { HintInput, HintLevel } from './hintdata.ts';
import type { Place, RouteVisit, SpoilerBuilding, SpoilerDialogue, SpoilerHint, SpoilerReward } from './spoiler.ts';
import { addPickupMessages, DESTROYER_ROOMS, pickupLine, placeBuildingItems, placePassageItem } from './pickups.ts';
import { applyDestroyers, DESTROYER_POSITIONS, type Destroyers, pickDestroyers } from './destroyers.ts';
import { applyStory } from './story.ts';
import { addFinalTimer } from './timer.ts';
import {
  ESCAPE_Y,
  HAL_Y,
  JOE_LETTER_Y,
  JOE_RESCUE_Y,
  JOE_SPEECH_Y,
  MISSION_REPORT_Y,
  pickBossLines,
  SELF_DESTRUCT_Y,
  STILL_INSIDE_Y,
} from './bosses.ts';
import { drawNonsense } from './nonsense.ts';
import { applyEndingScript, endingTableSize } from './ending.ts';
import { applyFastSpaces, FAST_SPACES_SIZE } from './printer.ts';
import { applyRoomLines, roomLinesSize, talkOnBossDeath } from './roomtalk.ts';
import { ROBOT_0B_SIZE, robotPortrait } from './robotportrait.ts';
import { applyClearScreen } from './clearscreen.ts';
import { shutterDoor } from './doorpanels.ts';
import { oracleRoute } from './oracle.ts';
import { buildSim, type SimSeed } from './sim.ts';
import { joinHyphens, oxfordCommas, singleSpaces, spaceCommas, spaceTitles, typoFixes } from './typos.ts';
import { type Message, messageForY, readMessage, wrap, writeMessages } from './text.ts';
import { applyTitleLogo, fixTitleLetterO } from './title.ts';
import {
  AREA_NUMBERS,
  applyMapLayout,
  EAST_ZONES,
  FIRST_HALF_AREAS,
  keepAt,
  type MapLayout,
  shuffleGroup,
  spotOf,
  vanillaLayout,
  ZONE_NUMBERS,
} from './zones.ts';
import {
  buildLocations,
  COMM_ITEMS,
  JOE_SIDE,
  VANILLA_LOCKED,
  GATE_PRESETS,
  GATE10_PRESETS,
  type Item,
  ITEM_ROOMS,
  ITEMS,
  PASSAGE_FLAG,
  PASSAGE_ROOM,
  type Area12Condition,
  type GateRequirement,
  area12NeedsJoe,
  area12Needs1011,
  type Location,
  type Rules,
  zoneNode,
} from './world.ts';

export const GENERATOR_VERSION = '0.24.0';

/**
 * The spoiler file (spoiler.ts: data, not prose; the route is the visual spoiler's). Places are { area: map number,
 * layout: O-number }, items ITEMS ids.
 */
export interface Spoiler {
  generator: string;
  seedCode: string;
  /** The gameplay options (settings.ts keys and values). */
  settings: Partial<Settings>;
  rewards: SpoilerReward[];
  /** Items the seed can't be beaten without. */
  required: Item[];
  /** The path depth (required items besides Super Joe), and any best-effort shortfall: of Minimum Logic Depth ('depth'),
   * of Communicators Required ('pathComm'). */
  logicDepth: { depth: number; short: ('depth' | 'pathComm')[] };
  /** The intended route: how a player following the clues gets through, without brute force (hints on). */
  route: RouteVisit[];
  /** The oracle route: a short way through for a player who knows every placement (oracle.ts). */
  oracle: RouteVisit[];
  buildings: SpoilerBuilding[];
  /** Communicator -> the areas that use it. */
  comms: Partial<Record<Item, Place[]>>;
  hints: SpoilerHint[];
  /** NZ19's three men by position, and the real one (null: the vanilla men). */
  destroyers: { men: { position: (typeof DESTROYER_POSITIONS)[number]; name: string }[]; real: string } | null;
  /** The dark areas (the Flare lights them; option "Dark Areas"). */
  dark: Place[];
  /** The areas whose door needs COMMUNICATE in their comm room (option "Comm Locks"). */
  locked: Place[];
  /** Whose boss says Joe was just transferred (the decoy area of Joe's trail; vanilla Area 9's); null: no clue on the trail. */
  joeTransferBoss: Place | null;
  /** Comedic or Nonsense story dialogue (option "Story Dialogue"). */
  dialogue?: SpoilerDialogue;
  /** Every map number and the layout there. */
  layouts: Place[];
  /** The items in the order a sweep gets them, by sphere (the win, Area 12, after the last). */
  playthrough: { location: string; item: Item }[][];
  cosmetics: { uniform: string; hair: string; enemy: string };
}

export interface GenerateResult {
  rom: Uint8Array;
  spoiler: Spoiler;
  /** Items obtainable in a game that never enters the second region (true requirements; a check for tests). */
  firstRegion: Item[];
  /** Hint lines that only help get something their own slot can't be read without (a check; should be empty). */
  circularHints: string[];
  /** The seed for the simulator (sim.ts): its places and what can be done there, by the game's own rules. */
  sim: SimSeed;
}

export interface GenerateOptions {
  cosmetics?: Partial<Cosmetics>;
  /** Seed for resolving 'random' cosmetics. Omit for a fresh roll each time (tests pass one for repeatability). */
  cosmeticSeed?: string;
  /** The generation date the final screen shows (default: today, local time). */
  date?: Date;
}

/** Items obtainable in a game that never sets foot in the second region (map numbers in JOE_SIDE). */
function firstRegionItems(locations: Location[], placement: Placement, rules: Rules): Item[] {
  const first = locations.filter((l) => l.at.some((m) => !JOE_SIDE.includes(m)));
  return sweep(first, placement, rules)
    .spheres.flat()
    .map((g) => g.item);
}

/** The spoiler's path depth, noting where it falls short of the options (best-effort). */
export function logicDepth(settings: Settings, required: Item[]): Spoiler['logicDepth'] {
  const depth = required.filter((i) => i !== 'joe').length;
  if (settings.rewards === 'vanilla') return { depth, short: [] };
  return {
    depth,
    short: [
      ...(depth < Number(settings.depth) ? ['depth' as const] : []),
      ...(settings.pathComm === 'on' && !required.some((i) => i === 'beta' || i === 'gamma' || i === 'delta')
        ? ['pathComm' as const]
        : []),
    ],
  };
}

/** A candidate seed's plan (planSeed's per-attempt state). */
interface Plan {
  layout: MapLayout;
  doors: ReturnType<typeof vanillaBuildings>;
  locations: Location[];
  placement: Placement;
  comms: CommAssignment;
  hints: ReturnType<typeof makeHints>;
  mustHave: Item[];
  trueLocations: Location[];
  area12Comm: Rules['area12Comm'];
}

/** Layouts tried for Minimum Logic Depth (and Communicators Required) before settling for the deepest so far. */
const DEPTH_BUDGET = 60; // (more never reached any further on 120 random settings; 60 is about 1.5 s at worst)
/** How close a seed comes: its path depth (besides Joe), and far more for a required β, γ or δ when wanted. */
const depthScore = (required: Item[], needComm: boolean) =>
  required.filter((i) => i !== 'joe').length +
  (needComm && required.some((i) => i === 'beta' || i === 'gamma' || i === 'delta') ? 100 : 0);

/** The real Destroyer as the route names him: his name, or with Nonsense (the men say no names)
 * where he stands. */
const trustName = (hints: string, d?: Destroyers) =>
  hints === 'nonsense' ? `the man ${DESTROYER_POSITIONS[d?.real ?? 0]}` : d ? d.names[d.real] : 'DESTROYER-3';

/**
 * A seed code's gameplay plan (no ROM needed): layouts, placement, hints. Throws on conflicting options (settings.ts;
 * `allowConflicts` tries anyway, for the tests) or if no beatable seed turns up.
 */
export function planSeed(seedCode: string, allowConflicts = false) {
  const { settings, seed } = parseSeedCode(seedCode);
  const clash = conflicts(settings);
  if (clash.length && !allowConflicts) throw new Error(`These options conflict: ${clash.map((c) => c.why).join(' ')}`);
  const code = makeSeedCode(settings, seed); // canonical form
  // (not the generator version: a release keeps every seed's features it didn't change)
  const stream = (feature: string) => new Rng(`${code}|${feature}`);
  const condition = settings.area12 as Area12Condition;

  // --- logic + item placement ---
  const rules: Rules = {
    area12: condition,
    gate: GATE_PRESETS[settings.gate],
    gate10: GATE10_PRESETS[settings.flak],
    flak: settings.flak === 'flak',
  };
  // A layout can strand a fixed item (e.g. γ beyond the road gate with the passage room behind it too): draw the next
  // layout from the same streams until one is beatable.
  const rngs = {
    zones: stream('zones'),
    areas: stream('areas'),
    buildings: stream('buildings'),
    rewards: stream('rewards'),
    comms: stream('comms'),
  };
  let layout!: MapLayout, doors!: ReturnType<typeof vanillaBuildings>, locations!: Location[], placement!: Placement;
  let comms!: CommAssignment;
  let hints!: ReturnType<typeof makeHints>;
  let mustHave!: Item[];
  let trueLocations!: Location[]; // the same, with only true requirements (no comm-in-hand rule) // what the game truly can't be beaten without
  /** NZ15's barrier weapon (before door B): the Machine Gun, the 3-Way Gun (Fixed), or none (vanilla: any shot). */
  const nz15: Item | undefined =
    settings.barrier === 'machine' ? 'machine' : settings.barrier === 'fixed' ? 'threeway' : undefined;
  const destroyers = settings.destroyer === 'shuffled' ? pickDestroyers(stream('destroyers')) : undefined;
  /** Dark layouts: O4, and with "Dark Areas: More" one or both of EXTRA_DARK_LAYOUTS. */
  const darkRng = stream('dark');
  const dark = [
    4,
    ...(settings.darkAreas === 'more'
      ? darkRng
          .shuffle([...EXTRA_DARK_LAYOUTS])
          .slice(0, 1 + darkRng.int(2))
          .sort((a, b) => a - b)
      : []),
  ];
  /** Comm-locked layouts: O1, O4, O8, and with "Comm Locks" 2-3 (More) or all (All) of EXTRA_COMM_LOCKS. */
  const lockRng = stream('locks');
  const extraLocks =
    settings.commLocks === 'all'
      ? [...EXTRA_COMM_LOCKS]
      : settings.commLocks === 'more'
        ? lockRng
            .shuffle([...EXTRA_COMM_LOCKS])
            .slice(0, 2 + lockRng.int(2))
            .sort((a, b) => a - b)
        : [];
  const locked = [...VANILLA_LOCKED, ...extraLocks].sort((a, b) => a - b);
  const trust = trustName(settings.hints, destroyers);
  const moles = destroyers ? destroyers.names.filter((_, i) => i !== destroyers.real) : ['DESTROYER-1', 'DESTROYER-2'];
  const minDepth = settings.rewards === 'vanilla' ? 0 : Number(settings.depth); // vanilla rewards: as they come
  const needComm = settings.rewards !== 'vanilla' && settings.pathComm === 'on';
  const lateRocket =
    settings.rocket === 'late' &&
    settings.rewards !== 'vanilla' &&
    !(settings.gate === 'vanilla' && settings.areas === 'vanilla');
  // Minimum Logic Depth (and Communicators Required) is best-effort: after DEPTH_BUDGET layouts short of it, the deepest
  // seed so far is used (the spoiler states the depth it got). No static rule says which combinations reach which depth
  // and a search to the end took up to 80 s to fail.
  let best: { score: number; plan: Plan } | undefined;
  for (let attempt = 0; ; attempt++) {
    if (best && attempt >= DEPTH_BUDGET) {
      ({ layout, doors, locations, placement, comms, hints, mustHave, trueLocations } = best.plan);
      rules.area12Comm = best.plan.area12Comm;
      break;
    }
    if (attempt === 1000) throw new Error('these settings could not produce a beatable seed');
    layout = vanillaLayout();
    if (settings.zones === 'shuffled') {
      shuffleGroup(layout, ZONE_NUMBERS, rngs.zones);
      // the interrogation room (NZ17's layout) stays east: the hidden passages are a shortcut, not a free way east
      // (shuffled interiors keep it east themselves)
      if (settings.buildings !== 'shuffled') keepAt(layout, 17, EAST_ZONES, rngs.zones);
    }
    if (settings.areas === 'shuffled') {
      shuffleGroup(layout, AREA_NUMBERS, rngs.areas);
      keepAt(layout, 1, FIRST_HALF_AREAS, rngs.areas); // the opening briefing sends you to Area 1's layout
    }
    doors =
      settings.buildings === 'shuffled'
        ? shuffleBuildings(
            rngs.buildings,
            EAST_ZONES.map((n) => layout.get(n) ?? n),
          )
        : vanillaBuildings();
    comms =
      settings.comms === 'shuffled'
        ? assignComms(
            rngs.comms,
            FIRST_HALF_AREAS.map((n) => layout.get(n) ?? n),
          )
        : vanillaComms();
    const commOf = (id: number) => comms[id];
    rules.area12Comm = settings.area12Comm === 'comms' || settings.area12Comm === 'both' ? comms[12] : undefined; // (the power system doors' lock)
    const build = (fair: boolean, commInHand = true) =>
      buildLocations(
        doors,
        spotOf(layout),
        settings.gate === 'iff' ? 'iff' : undefined,
        settings.pickups === 'shuffled',
        commOf,
        rules.flak,
        { nz15, destroyer: !!destroyers, fair, trueDark: settings.dark === 'true', dark, locked, commInHand },
      );
    locations = build(true);
    if (!feasible(locations, rules)) continue;
    if (settings.rewards === 'vanilla') {
      placement = new Map(locations.map((l) => [l.id, l.vanilla]));
      if (!isCompletable(locations, placement, rules)) continue;
    } else {
      try {
        placement = fill(locations, rules, rngs.rewards);
      } catch {
        continue; /* next layout */
      }
    }
    // "No early Rocket Launcher": not obtainable in a game that never sets foot in the second region (it may sit in
    // the first behind something only found there, e.g. NZ15's Machine Gun barrier with the gun past the crossing)
    // (not with vanilla rewards; nor with the vanilla 6<->8 gate on vanilla layouts: the gate needs Area 6 cleared, whose
    // boss needs the rocket)
    trueLocations = build(false);
    // (true requirements only: an area's comm in hand is the route's rule, not a lock unless its doors are comm-locked)
    const rocketOk = (p: Placement) => !lateRocket || !firstRegionItems(trueLocations, p, rules).includes('rocket');
    if (!rocketOk(placement)) continue; // (before the depth check: cheaper)
    // path depth: what the game truly can't be beaten without (besides Joe; not the route's comm-in-hand rule), and
    // whether that includes a comm besides α (a comm-locked door, or the vanilla road gates). A shallow fill is
    // deepened by swapping items (hill-climb) before giving up on it.
    const deepEnough = (req: Item[]) =>
      req.length >= minDepth && (!needComm || req.some((i) => i === 'beta' || i === 'gamma' || i === 'delta'));
    const requiredOf = (p: Placement) => requiredItems(trueLocations, p, rules).filter((i) => i !== 'joe');
    if (settings.rewards !== 'vanilla' && !deepEnough(requiredOf(placement))) {
      placement = deepen(locations, trueLocations, placement, rules, rngs.rewards, {
        minDepth,
        wantComm: needComm,
        valid: rocketOk,
      });
    }
    mustHave = requiredItems(trueLocations, placement, rules);
    const deep = deepEnough(mustHave.filter((i) => i !== 'joe'));
    const score = depthScore(mustHave, needComm);
    if (!deep && best && score <= best.score) continue;
    // hints that lead along a full path (a rare dead end: next layout)
    const spot = spotOf(layout),
      at = (n: number) => layout.get(n) ?? n;
    try {
      hints = makeHints(
        {
          locations,
          placement,
          rules,
          spot,
          at,
          comms,
          doors,
          itemRooms: roomsOf(placement),
          level: settings.hints as HintLevel,
          // (the route spoiler with no hints: an area with a comm room is cleared without its comm in hand; the seed's logic keeps the rule)
          routeLocations:
            settings.hints === 'vanilla' || settings.hints === 'nonsense' ? build(true, false) : undefined,
          area12Locks: settings.area12Comm as HintInput['area12Locks'],
          typosFixed: settings.typos === 'fixed',
          trust,
          trustAt: DESTROYER_POSITIONS[destroyers?.real ?? 0],
          moles,
          trustDoor: DESTROYER_POSITIONS[destroyers?.real ?? 0].includes('door A') ? 'A' : 'B',
          nz15,
          dark,
          locked,
        },
        stream('hints'),
      );
    } catch {
      continue;
    }
    if (deep) break;
    best = {
      score,
      plan: {
        layout,
        doors,
        locations,
        placement,
        comms,
        hints,
        mustHave,
        trueLocations,
        area12Comm: rules.area12Comm,
      },
    };
  }
  return {
    settings,
    code,
    stream,
    condition,
    rules,
    layout,
    doors,
    locations,
    placement,
    comms,
    hints,
    mustHave,
    trueLocations,
    destroyers,
    dark,
    locked,
    extraLocks,
    nz15,
  };
}

/** What each building item room holds. */
const roomsOf = (placement: Placement) =>
  new Map([...vanillaItemRooms().keys()].map((room) => [room, placement.get(`room${room.toString(16)}`)!]));

/**
 * Produce a patched ROM. Gameplay is fully determined by (generator version, seed code): each gameplay feature draws
 * from its own named RNG stream so adding features later doesn't reshuffle existing ones. Cosmetics are applied last
 * from a separate RNG and never influence gameplay.
 */
export function generate(inputRom: Uint8Array, seedCode: string, options: GenerateOptions = {}): GenerateResult {
  const check = verifyRom(inputRom);
  if (!check.ok) throw new Error(check.error);
  const rom = check.rom;
  const cosmetics = normalizeCosmetics(options.cosmetics ?? {}); // (checked up front; applied with the text and at the end)
  const seed = prepareSeed(seedCode);
  placeItems(rom, seed);
  gameplayPatches(rom, seed);
  roadPatches(rom, seed);
  newGamePatches(rom, seed);
  applyMapLayout(rom, seed.layout);
  const story = textPatches(rom, seed, options);
  setArea12Condition(rom, area12Flags(seed));
  const looks = presentation(rom, cosmetics, options);
  return results(rom, seed, story, looks);
}

/** A planned seed (planSeed) with what the patching stages share. */
type Seed = ReturnType<typeof prepareSeed>;

function prepareSeed(seedCode: string) {
  const plan = planSeed(seedCode);
  const { settings, layout, locations, placement, rules, destroyers } = plan;
  const spot = spotOf(layout);
  const at = (n: number) => layout.get(n) ?? n; // identity (layout) at map number n
  // what each building item room holds now
  const itemRooms = roomsOf(placement);
  const movedRooms = new Map([...itemRooms].filter(([room, item]) => item !== ITEM_ROOMS[room]));
  const movedItemRooms = movedRooms.size > 0; // (the door lines describe the item rooms, not the Destroyers')
  const destroyerItem = placement.get('destroyer')!;
  if (destroyers) for (const room of DESTROYER_ROOMS) movedRooms.set(room, destroyerItem);
  if (!isCompletable(locations, placement, rules)) throw new Error('internal error: generated seed is not beatable');

  const joeHost = locations.find((l) => l.areaClear && placement.get(l.id) === 'joe')!.areaClear!;
  // (every seed but a fully vanilla one: our credits and final screen)
  const normalized = normalizeSettings(settings);
  const ours = GAMEPLAY_SCHEMA.some((o) => normalized[o.key] !== VANILLA_SETTINGS[o.key]);
  return { ...plan, spot, at, itemRooms, movedRooms, movedItemRooms, destroyerItem, joeHost, ours };
}

/** The flags Area 12's entry requires. "Areas 10 & 11" means the map numbers: whichever layouts sit there. */
function area12Flags({ condition, at }: Seed): number[] {
  return [
    ...(area12NeedsJoe(condition) ? [FLAG_JOE] : []),
    ...(area12Needs1011(condition) ? [flagAreaCleared(at(10)), flagAreaCleared(at(11))] : []),
  ];
}

/** The items: Joe and the area-clear rewards, the building and passage items, the clear screen's names, communicators. */
function placeItems(rom: Uint8Array, seed: Seed) {
  const { comms, joeHost, locations, movedRooms, placement, settings } = seed;
  placeJoe(rom, joeHost);
  for (const l of locations) {
    const item = placement.get(l.id)!;
    if (l.areaClear && item !== 'joe') setAreaClearReward(rom, l.areaClear, item); // (a vanilla item rewrites itself)
  }
  placeBuildingItems(rom, movedRooms);
  placePassageItem(rom, placement.get('passage')!);
  // the clear screen's names from bank 0B: needed for names the vanilla block lacks (IFF Code, Flare, communicators)
  // and for the underground passage's own clear screen (with the pickup messages)
  const clearNames = new Map(
    locations
      .filter((l) => l.areaClear && placement.get(l.id) !== 'joe')
      .map((l) => [l.areaClear!, placement.get(l.id)!]),
  );
  const passageClear = settings.pickupText === 'on' ? placement.get('passage')! : undefined;
  if (passageClear || [...clearNames.values()].some((i) => (ITEMS[i].clearText ?? 0) >= 0x96))
    applyClearScreen(rom, clearNames, passageClear);
  if (settings.comms === 'shuffled') applyComms(rom, comms);
}

/** Gameplay fixes and options: weapons, darkness, turrets, door locks and comm flags, short messages, top-down stages. */
function gameplayPatches(rom: Uint8Array, seed: Seed) {
  const { dark, extraLocks, settings } = seed;
  removeRoadGates(rom);
  fixCommPageBoxes(rom);
  fixPassageGate(rom);
  if (settings.rapidFire === 'on') fixRapidFire(rom);
  if (settings.machineGun === 'on') machineGunAuto(rom);
  if (settings.machineGun === 'on' || settings.rapidFire === 'on')
    topDownFire(rom, { machine: settings.machineGun === 'on', rapid: settings.rapidFire === 'on' });
  if (settings.dark === 'true') trueDark(rom);
  if (dark.length > 1) darkAreas(rom, dark.slice(1));
  if (settings.turrets === 'destructible') destructibleTurrets(rom);
  if (settings.area12Comm !== 'none') area12CommLock(rom, settings.area12Comm as 'comms' | 'boss' | 'both');
  const lockRows = [
    ...commLockRows(extraLocks),
    ...(settings.area12Comm !== 'none' ? area12LockRows(settings.area12Comm as 'comms' | 'boss' | 'both') : []),
  ];
  applyDoorLocks(rom, lockRows); // (always: the vanilla locks' doors are drawn sealed too)
  if (settings.area12Comm !== 'none') shutterDoor(rom); // (Area 12's miniboss room: its exit door opens like the power rooms')
  const flagRows = [
    ...commLockFlagRows(extraLocks),
    ...(settings.area12Comm !== 'none' ? area12FlagRows(settings.area12Comm as 'comms' | 'boss' | 'both') : []),
  ];
  if (flagRows.length) commFlagSetter(rom, flagRows);
  if (settings.hints === 'nonsense') {
    oneBriefingMessage(rom);
    oneLineWiretaps(rom);
    oneRescueLine(rom);
  } // (one message each: Area 1's first COMMUNICATE, every wiretap, Joe at his rescue)
  // (with Truck Encounters Off too: the underground passage still has its enemies)
  if (settings.topDownDrops === 'on') topDownDrops(rom, settings.eagles as Eagles);
  else if (settings.eagles === 'oneup') eagleOneUps(rom);
  else if (settings.eagles === 'none') noEagles(rom);
  if (settings.timer === 'on') addFinalTimer(rom);
}

/** The map's roads: the region gates (6-8, 8-10, the Flak Map), NZ15's barriers, trucks, travel speed. */
function roadPatches(rom: Uint8Array, seed: Seed) {
  const { at, rules, settings } = seed;
  if (rules.gate) {
    const { areas, items } = rules.gate;
    setRoadGate(rom, at(6), at(8), [
      ...areas.map((m) => flagAreaCleared(at(m))),
      ...items.map((i) => 0xca + ITEMS[i].inventory),
    ]);
  }
  if (rules.flak) addFlakMap(rom, at(8), at(10));
  else if (rules.gate10)
    setRoad10Gate(rom, at(8), at(10), {
      flags: [
        ...rules.gate10.items.map((i) => 0xca + ITEMS[i].inventory),
        ...rules.gate10.areas.map((m) => flagAreaCleared(at(m))),
      ],
    });
  // (Fixed: the vanilla check, whose "anything else" type is the 3-Way Gun's; docs/rom-notes.md#barriers)
  if (settings.barrier !== 'vanilla')
    setBarrierWeapons(rom, settings.barrier === 'machine' ? SHOT_TYPE.machine : SHOT_TYPE.threeway);
  if (settings.trucks === 'off') disableTrucks(rom);
  if (settings.mapSpeed !== '1') setMapSpeed(rom, Number(settings.mapSpeed));
}

/** The map screen (markers, gate display) and a new game's state (lives, continues, health, cleared flags). */
function newGamePatches(rom: Uint8Array, seed: Seed) {
  const { at, destroyerItem, doors, itemRooms, layout, rules, settings } = seed;
  if (settings.lives !== '3') setLives(rom, Number(settings.lives));
  // Unlimited continues: start with 9 (the most the counter shows) and never spend one.
  const unlimited = settings.continues === 'unlimited';
  if (unlimited) unlimitedContinues(rom);
  const continues = unlimited ? 9 : Number(settings.continues);
  const markers = settings.markers === 'on';
  if (markers) {
    // a neutral zone turns green once its significant items are taken (not 1UPs); its building items are unique
    const flagOf = (item: Item) =>
      item === 'flak' ? FLAK_FLAG : item === 'passage' ? PASSAGE_FLAG : 0x04ca + ITEMS[item].inventory;
    const zoneFlags = new Map<number, number[]>();
    for (const [room, item] of [...itemRooms, [PASSAGE_ROOM, 'passage'], [DESTROYER_ROOMS[0], destroyerItem]] as [
      number,
      Item,
    ][]) {
      if (item === 'oneup') continue;
      const zone = zoneNode(doors.get(room)!.zone);
      zoneFlags.set(zone, [...(zoneFlags.get(zone) ?? []), flagOf(item)]);
    }
    applyMapMarkers(rom, layout, zoneFlags);
  }
  if (settings.gateDisplay === 'on') {
    // (after the markers: it chains onto their map-build hook)
    const flagsOf = (r: GateRequirement) => [
      ...r.areas.map((m) => 0x0400 + flagAreaCleared(at(m))),
      ...r.items.map((i) => 0x04ca + ITEMS[i].inventory),
    ];
    applyGateDisplay(rom, {
      road68: rules.gate && flagsOf(rules.gate),
      road810: rules.flak ? [FLAK_FLAG] : rules.gate10 && flagsOf(rules.gate10),
      iff: rules.gate?.items.includes('iff') ? 0x04ca + ITEMS.iff.inventory : undefined,
      flak: rules.flak ? FLAK_FLAG : undefined,
    });
  }
  const rank = Number(settings.health); // pips = rank 0-8
  const clear = [
    ...(markers ? [VISITED, VISITED + 1, VISITED + 2] : []),
    ...(rules.flak ? [FLAK_FLAG] : []),
    ...(settings.area12Comm === 'boss' || settings.area12Comm === 'both' ? [BOSS_21] : []),
  ];
  if (rank || continues || clear.length) setNewGameState(rom, { rank, continues, clear });
}

/** All text in one repack (story, Destroyers, hints, buildings, Nonsense, typo fixes, boss dialogue, credits, pickups),
 * then what's placed after it in bank 0B: the printer hook, the ending script, room lines, the final screen. */
function textPatches(rom: Uint8Array, seed: Seed, options: GenerateOptions) {
  const {
    at,
    code,
    comms,
    condition,
    dark,
    destroyerItem,
    destroyers,
    doors,
    hints,
    itemRooms,
    joeHost,
    locations,
    movedItemRooms,
    ours,
    settings,
    spot,
    stream,
  } = seed;
  // all text in one repack (buildings' door lines win over the story's flare line, which they include)
  // the boss who says Joe was just moved: the decoy area of Joe's trail, if a clue names it
  const transferArea = hints.trailArea === undefined ? undefined : at(hints.trailArea);
  // (should a seed's random lines overflow bank 0B's text space, the comedic and Nonsense lines are drawn again from
  // the next stream, deterministically; gameplay is untouched. A safety net: no seed in 1500 needed it once Joe's
  // speech and the escape radio's vanilla messages were freed)
  const beforeText = rom.slice();
  let text!: Map<number, string | Message>,
    bosses: ReturnType<typeof pickBossLines> | undefined,
    nonsense: ReturnType<typeof drawNonsense> | undefined;
  let lines: (readonly [number, Message, boolean])[] = [],
    endingLines: Message[] = [],
    texts: Message[] = [],
    extraAt: number[] = [];
  for (let attempt = 0; ; attempt++) {
    rom.set(beforeText);
    try {
      text = applyStory(rom, {
        joeArea: joeHost,
        transferArea,
        area12: condition,
        spot,
        gate: settings.gate,
        gate10: settings.flak,
        dark,
        oxford: settings.typos === 'fixed',
        typos: settings.typos === 'fixed',
        commOf: (id) => comms[id],
        interrogation: locations.find((l) => l.id === 'interrogation')!.at[0],
      });
      if (destroyers)
        for (const [n, line] of applyDestroyers(rom, destroyers, destroyerItem, spot(18))) text.set(n, line);
      for (const [n, line] of hints.messages) text.set(n, line);
      if (settings.buildings === 'shuffled' || movedItemRooms || hints.talkerAddenda.size) {
        for (const [n, line] of applyBuildings(
          rom,
          doors,
          itemRooms,
          dark.map(spot),
          settings.buildings === 'shuffled',
          hints.talkerAddenda,
        ))
          text.set(n, line);
      }
      // (Nonsense: the talkers say only nonsense, not their doors' contents; a full bank draws again with fewer radio lines)
      if (settings.hints === 'nonsense') {
        nonsense = drawNonsense(
          stream(attempt ? `nonsense#${attempt}` : 'nonsense'),
          hints.nonsenseSlots,
          (y) => readMessage(beforeText, messageForY(y))!.header,
          Math.max(600, 3200 - 400 * attempt),
        );
        for (const [n, line] of nonsense.messages) text.set(n, line);
      }
      if (settings.titleO === 'fixed') fixTitleLetterO(rom);
      if (settings.typos === 'fixed') for (const [n, line] of typoFixes(rom)) if (!text.has(n)) text.set(n, line);
      // (a space after each comma, broken words whole again where the page has room, one space after a sentence; vanilla
      // and rewritten lines)
      if (settings.typos === 'fixed') {
        const fix = (t: string) => singleSpaces(spaceTitles(spaceCommas(joinHyphens(oxfordCommas(t)))));
        for (let n = 2; n <= 129; n++)
          if (!text.has(n)) {
            const m = readMessage(rom, n);
            if (m && fix(m.text) !== m.text) text.set(n, fix(m.text));
          }
        for (const [n, m] of text) text.set(n, typeof m === 'string' ? fix(m) : { ...m, text: fix(m.text) });
      }
      // (hint mode Nonsense with vanilla boss dialogue: the bosses say the talkers' nonsense)
      const bossStream = stream(attempt ? `bosses#${attempt}` : 'bosses');
      bosses =
        settings.story === 'comedic'
          ? pickBossLines(rom, bossStream, spot, joeHost, transferArea)
          : nonsense
            ? pickBossLines(rom, bossStream, spot, joeHost, transferArea, { said: nonsense.talkerLines })
            : undefined;
      if (bosses) for (const [n, blank] of bosses.freed) text.set(n, blank); // (story.ts's Joe lines too: nobody shows them)
      if (bosses?.escape) text.set(messageForY(ESCAPE_Y), bosses.escape);
      if (bosses?.selfDestruct) text.set(messageForY(SELF_DESTRUCT_Y), bosses.selfDestruct);
      if (bosses?.joeLetter) {
        text.set(messageForY(JOE_LETTER_Y), bosses.joeLetter);
        setLetterWait(rom, bosses.joeLetter.text);
      }
      if (bosses?.missionReport) text.set(messageForY(MISSION_REPORT_Y), bosses.missionReport);
      if (bosses?.stillInside) text.set(messageForY(STILL_INSIDE_Y), bosses.stillInside);
      bosses?.rescue?.forEach((m, i) => text.set(messageForY([JOE_RESCUE_Y, ...JOE_SPEECH_Y][i]), m)); // (over Nonsense's lines: comedic wins)
      if (bosses?.hal) text.set(messageForY(HAL_Y), wrap(bosses.hal));
      // our credits in the ending
      if (ours) text.set(messageForY(CREDITS_Y), { header: CREDITS_HEADER, text: creditsText() });
      // Ladd's "WE'VE OBTAINED" for every building pickup (not the NZ19 B 1UP, a different object)
      const pickups =
        settings.pickupText === 'on'
          ? [...itemRooms, ...DESTROYER_ROOMS.map((room) => [room, destroyerItem] as const)].filter(
              ([, item]) => item !== 'oneup',
            )
          : [];
      if (pickups.length) addPickupMessages(rom);
      // (rooms with the same line, the two Destroyer rooms, share one copy)
      // (a room's second line, shown by talk with ALT_Y: a pickup's, a boss's death reply)
      lines = [
        ...(bosses?.rooms ?? []).map((room, i) => [room, bosses!.texts[i], false] as const),
        ...(bosses?.replies ?? []).map(({ room, text }) => [room, text, true] as const),
        ...pickups.map(([room, item]) => [room, pickupLine(rom, item), true] as const),
      ];
      endingLines = bosses?.ending
        ? [...bosses.ending.killt, ...bosses.ending.masterD, ...bosses.ending.cockpit, ...bosses.ending.radio]
        : [];
      texts = [
        ...new Map([...lines.map(([, m]) => m), ...endingLines].map((m) => [`${m.header}|${m.text}`, m])).values(),
      ];
      // (then bank 0B room for the printer's space-skipping hook, the room lines' lookup and, with the ending's lines, their
      // address table)
      extraAt = writeMessages(rom, text, [
        ...texts,
        { reserve: FAST_SPACES_SIZE },
        { reserve: roomLinesSize(lines.length) },
        ...(bosses?.ending ? [{ reserve: endingTableSize(endingLines.length) }] : []),
        ...(settings.d1Portrait === 'on' ? [{ reserve: ROBOT_0B_SIZE }] : []),
        ...(ours ? [{ reserve: FONT_COPY_SIZE }] : []),
      ]);
      break;
    } catch (e) {
      if ((!bosses && !nonsense) || attempt >= 20 || !/^text bank full/.test((e as Error).message)) throw e;
    }
  }
  // (Joe's comedic answer, then his tip; with Nonsense, no tip)
  if (bosses?.rescue) skipRescueSpeech(rom, bosses.rescue.length, settings.hints !== 'nonsense');
  applyFastSpaces(rom, extraAt[texts.length]);
  if (settings.d1Portrait === 'on') robotPortrait(rom, extraAt[texts.length + (bosses?.ending ? 3 : 2)]);
  if (ours)
    finalScreen(
      rom,
      {
        style: runStyle(settings),
        seedCode: code,
        version: GENERATOR_VERSION,
        timer: settings.timer === 'on',
        date: options.date ?? new Date(),
      },
      extraAt[texts.length + (bosses?.ending ? 3 : 2) + (settings.d1Portrait === 'on' ? 1 : 0)],
    );
  const addrOf = (m: Message) => extraAt[texts.findIndex((t) => t.header === m.header && t.text === m.text)];
  if (bosses?.ending)
    applyEndingScript(
      rom,
      bosses.ending.killt.map(addrOf),
      bosses.ending.masterD.map(addrOf),
      bosses.ending.cockpit.map(addrOf),
      bosses.ending.radio.map(addrOf),
      extraAt[texts.length + 2],
    );
  // (a second line answers only its own talk: the room's talkers keep theirs)
  applyRoomLines(
    rom,
    lines.map(([room, m, alt]) => ({ room, alt, addr: addrOf(m) })),
    extraAt[texts.length + 1],
  );
  if (bosses)
    talkOnBossDeath(
      rom,
      bosses.replies.map((r) => r.room),
    );
  return { bosses, nonsense, transferArea };
}

/** The title logo and the palettes (cosmetics: from their own RNG, never gameplay's). */
function presentation(rom: Uint8Array, cosmetics: Cosmetics, options: GenerateOptions) {
  applyTitleLogo(rom); // always: the randomizer's "BIONIC COMRANDO" title
  const cosmeticRng = new Rng(`cosmetics|${options.cosmeticSeed ?? randomSeed(16)}`);
  // (the two uniforms never match when either is random)
  const palette = applyPlayerPalette(
    rom,
    cosmetics.uniformColor,
    cosmetics.hairColor,
    cosmeticRng,
    enemyColorValue(cosmetics.enemyColor),
  );
  const enemy = applyEnemyPalette(rom, cosmetics.enemyColor, cosmeticRng, UNIFORM_COLORS[palette.uniform]);

  return { palette, enemy };
}

/** The result: the ROM, its spoiler, the simulator's seed and checks for the tests. */
function results(
  rom: Uint8Array,
  seed: Seed,
  story: ReturnType<typeof textPatches>,
  looks: ReturnType<typeof presentation>,
): GenerateResult {
  const {
    at,
    code,
    comms,
    dark,
    destroyers,
    doors,
    hints,
    itemRooms,
    layout,
    locations,
    locked,
    mustHave,
    nz15,
    placement,
    rules,
    settings,
    spot,
    trueLocations,
  } = seed;
  const { bosses, nonsense, transferArea } = story;
  const { palette, enemy } = looks;
  const play = sweep(locations, placement, rules);
  // (hints Vanilla: the route quotes the lines as the ROM says them, ⟪message Y⟫; rows of 16 cells)
  const quote = (y: number) =>
    readMessage(rom, messageForY(y))!
      .text.match(/.{1,16}/g)!
      .map((r) => r.trim())
      .filter(Boolean)
      .join(' ');
  const quoted = (t: string) => t.replace(/⟪(\d+)⟫/g, (_, y: string) => quote(Number(y)));
  const place = (layout: number): Place => ({ area: spot(layout), layout });
  const where = (l: Location): Omit<SpoilerReward, 'location' | 'item'> => {
    if (l.areaClear) return place(l.areaClear);
    if (l.id === 'destroyer') return place(18);
    const room =
      l.id === 'interrogation' ? PASSAGE_ROOM : l.id.startsWith('room') ? parseInt(l.id.slice(4), 16) : undefined;
    const d = room === undefined ? undefined : doors.get(room);
    return d ? { ...place(zoneNode(d.zone)), door: d.slot ? 'B' : 'A' } : {}; // (the underground passage: no area)
  };
  const route = hints.route.map((e) => ({
    ...e,
    steps: e.steps.map((st) => ('quote' in st && st.quote !== undefined ? { ...st, quote: quoted(st.quote) } : st)),
  }));
  return {
    rom,
    firstRegion: firstRegionItems(trueLocations, placement, rules),
    circularHints: hints.circularLines,
    sim: buildSim({
      rom,
      rules,
      locations: trueLocations,
      placement,
      layout,
      comms,
      doors,
      itemRooms,
      dark,
      trueDark: settings.dark === 'true',
      locked,
      nz15,
      area12Locks: settings.area12Comm as 'none' | 'comms' | 'boss' | 'both',
      destroyers,
      namedDestroyers: settings.hints !== 'nonsense',
      briefingNamesArea: settings.hints !== 'nonsense',
      facts: hints.facts,
      ...(hints.rescueTells && { rescueTells: hints.rescueTells }),
    }),
    spoiler: {
      generator: GENERATOR_VERSION,
      seedCode: code,
      settings: Object.fromEntries(GAMEPLAY_SCHEMA.map((o) => [o.key, settings[o.key]])),
      rewards: locations
        .filter((l) => l.shuffled)
        .map((l) => ({ location: l.id, ...where(l), item: placement.get(l.id)! })),
      required: mustHave,
      logicDepth: logicDepth(settings, mustHave),
      route,
      oracle: oracleRoute({
        locations: trueLocations,
        placement,
        rules,
        at,
        ...(settings.hints !== 'nonsense' && { trust: trustName(settings.hints, destroyers) }),
        trustAt: DESTROYER_POSITIONS[destroyers?.real ?? 0],
        trustDoor: DESTROYER_POSITIONS[destroyers?.real ?? 0].includes('door A') ? 'A' : 'B',
        area12Locks: settings.area12Comm as 'none' | 'comms' | 'boss' | 'both',
        dark,
        trueDark: settings.dark === 'true',
        locked,
      }),
      buildings: buildingSpoiler(doors, itemRooms, spot),
      comms: Object.fromEntries(
        COMM_ITEMS.map((c) => [
          c,
          [...Array(12).keys()]
            .map((i) => i + 1)
            .filter((n) => comms[n] === c)
            .map(place)
            .sort((a, b) => a.area - b.area),
        ]),
      ),
      hints: [...hints.spoiler, ...(nonsense?.spoiler ?? [])],
      destroyers: destroyers
        ? {
            men: DESTROYER_POSITIONS.map((position, i) => ({ position, name: destroyers.names[i] })),
            real: destroyers.names[destroyers.real],
          }
        : null,
      dark: dark.map(place).sort((a, b) => a.area - b.area),
      locked: [...locked].map(place).sort((a, b) => a.area - b.area),
      joeTransferBoss: transferArea === undefined ? null : place(transferArea),
      ...(bosses && { dialogue: bosses.spoiler }),
      layouts: [...layout].map(([area, layout]) => ({ area, layout })).sort((a, b) => a.area - b.area),
      playthrough: play.spheres.map((sphere) => sphere.map((g) => ({ location: g.location, item: g.item }))),
      cosmetics: { uniform: palette.uniform, hair: palette.hair, enemy },
    },
  };
}
