// Gameplay settings and the seed code. A seed code carries every gameplay setting plus the random seed, so the same
// code always produces the same gameplay. Cosmetics are separate (cosmetics.ts) and never part of the code.
//
// Seed code: "<first char><base 32 bits>" (ALPHABET: uppercase and digits, so the final screen can show it). The first
// char is the code format's version and the kind together (no character wasted on either): this
// format's are CODE_KINDS, a preset's letter (V, S, R, B), bits = the 54 random seed bits; or C, custom, bits = the seed
// bits, then each option's value index (counted from the option's vanilla value, so Vanilla is all zeros) in
// ceil(log2(#values)) bits, MSB first. Zero-padded to a multiple of 5. A shorter custom code decodes missing trailing
// options as their defaults. A preset code means the preset as the generator version that reads it defines it.
// Once seeds must stay valid (a release): only APPEND options and values, never reorder/remove or change a default. A
// new preset takes a new first char; an incompatible change to the custom layout moves custom to one no format used
// yet (preset codes, the seed only, keep theirs). 27 are left; if they ever run out, one can mean a longer prefix
// follows.

export type Settings = Record<string, string>;

export interface OptionSchema {
  key: string;
  label: string;
  /** Value ids, in display order. */
  values: readonly string[];
  /** Short names (the web app's chips and dropdown entries). */
  valueLabels: readonly string[];
  /** Default value (else the first). */
  default?: string;
  /** More about the option (web app: the info tooltip, with the value labels). */
  caption?: string;
  /** The value that plays like the original game (preset "Vanilla"; else 'vanilla'). */
  vanilla?: string;
  /** What the option needs to matter, one line per need (web app: the tooltip's bold first lines). */
  requires?: readonly string[];
  /** What each value does (web app: the tooltip's "label: info" lines). */
  valueInfo?: readonly string[];
  /** A closing remark (web app: the tooltip's italic last line). */
  note?: string;
}

export const GAMEPLAY_SCHEMA: readonly OptionSchema[] = [
  // (the vanilla value first throughout)
  {
    key: 'rewards',
    label: 'Area Clear Rewards',
    caption: 'Rewards for clearing each enemy area (1-11), Super Joe included',
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['No changes to the original rewards', 'Reward pool is randomly shuffled'],
    default: 'shuffled',
  },
  {
    key: 'pickups',
    label: 'Room/Passage Items',
    requires: ['Area Clear Rewards: Shuffled'],
    caption: 'Items found in NZ rooms and the underground passage',
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['No changes to the original items', 'Merged with the shuffled reward pool'],
    default: 'shuffled',
  },
  {
    key: 'area12',
    label: 'Area 12 Entry',
    caption: 'What enables entering Area 12 (the final area)',
    values: ['vanilla', 'joe', 'joe+10+11'],
    valueLabels: ['Vanilla', 'Super Joe', 'Joe, 10, & 11'],
    valueInfo: ['Area 10 & 11 cleared', 'Super Joe rescued', 'Super Joe rescued and Areas 10 & 11 cleared'],
    default: 'joe',
  },
  {
    key: 'area12Comm',
    label: 'Area 12 Door Locks',
    caption: 'Additional requirements to complete Area 12',
    values: ['none', 'comms', 'boss', 'both'],
    valueLabels: ['Open', 'Comms', 'Boss', 'Both'],
    valueInfo: [
      'No changes to the original game',
      'Comm rooms open power system doors',
      'Defeat the mini-boss to open the second power system door',
      'First comm opens first power system door, second comm opens mini-boss door, mini-boss opens second power system door',
    ],
    default: 'comms',
    vanilla: 'none',
  },
  {
    key: 'gate',
    label: 'Path 6↔8 Gate',
    caption: 'What enables entering the second region',
    values: ['vanilla', 'iff', 'open'],
    valueLabels: ['Vanilla', 'IFF Code', 'Open'],
    valueInfo: ['Areas 3 & 6 cleared, γ obtained', 'IFF Code (new item) obtained', 'No requirement'],
    default: 'iff',
  },
  {
    key: 'flak',
    label: 'Path 8↔10 Gate',
    caption: 'What enables entering the third region',
    values: ['vanilla', 'flak', 'open'],
    valueLabels: ['Vanilla', 'Flak Map', 'Open'],
    valueInfo: ['Area 7 cleared, δ obtained', 'Flak Map (new item) obtained', 'No requirement'],
    default: 'flak',
  },
  {
    key: 'barrier',
    label: 'NZ15 Barriers',
    caption: 'Behavior of the barriers in NZ15',
    values: ['vanilla', 'fixed', 'machine'],
    valueLabels: ['Vanilla', 'Fixed', 'Machine Gun'],
    valueInfo: [
      'Any weapon fire clears the barriers',
      'The 3-Way Gun clears the barriers',
      'The Machine Gun clears the barriers',
    ],
    default: 'machine',
  },
  {
    key: 'dark',
    label: 'Darkness',
    caption: 'Behavior of darkness in the dark areas without flare',
    values: ['vanilla', 'true'],
    valueLabels: ['Vanilla', 'True Dark'],
    valueInfo: ['Dim monochrome, enemy shadows visible', 'Pitch black, only Ladd visible'],
    default: 'vanilla',
  },
  {
    key: 'darkAreas',
    label: 'Dark Areas',
    caption: 'Which areas are dark until the flare is used',
    values: ['vanilla', 'more'],
    valueLabels: ['Vanilla', 'More'],
    valueInfo: ['Only the Area O4 cave', 'One or two more dark areas are added'],
    default: 'vanilla',
  },
  {
    key: 'destroyer',
    label: 'Destroyers',
    caption: 'NZ18\'s "Destroyer"s: one real, two moles',
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['Destroyer-3 has the real machine gun', 'Use hints to identify or be punished'],
    default: 'shuffled',
  },
  {
    key: 'rocket',
    label: 'No Early Rocket Launcher',
    requires: ['Area Clear Rewards: Shuffled', 'Path 6↔8 Gate: Non-Vanilla -or- Enemy Areas: Shuffled'],
    caption: 'Whether the Rocket Launcher may be found early in the run',
    values: ['any', 'late'],
    valueLabels: ['Off', 'On'],
    valueInfo: [
      'No restriction on how early the Rocket Launcher may be found',
      "The Rocket Launcher can't be found before reaching the second region",
    ],
    default: 'late',
    vanilla: 'any',
  },
  {
    key: 'depth',
    label: 'Minimum Logic Depth',
    requires: ['Area Clear Rewards: Shuffled'],
    caption: 'The fewest required reward logic steps (not including Super Joe) to finish',
    values: ['0', '3', '4', '5', '6'],
    valueLabels: ['Any', '3', '4', '5', '6'],
    note: "Best effort, not guaranteed: if a seed can't reach it, the deepest one found is used, and the spoiler log states its actual depth",
    default: '4',
    vanilla: '0',
  },
  {
    key: 'pathComm',
    label: 'Communicators Required',
    requires: ['Area Clear Rewards: Shuffled'],
    caption: 'Whether additional communicators are required to finish',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: [
      'It might be possible to finish the run with only α',
      'At least one of β, γ, or δ are required to finish',
    ],
    note: 'Best effort, not guaranteed; check spoiler log for failures',
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'trucks',
    label: 'Truck Encounters',
    caption: 'The enemy trucks that stop your helicopter on the map',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No truck encounters and no way to obtain continues', 'No change to the original behavior'],
    default: 'off',
    vanilla: 'on',
  },
  {
    key: 'health',
    label: 'Starting Health',
    caption: 'Number of health pips (XP level) at the start of a game, normally 0',
    values: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
    valueLabels: ['0 (vanilla)', '1', '2', '3', '4', '5', '6', '7', '8 (max)'],
    default: '0',
    vanilla: '0',
  },
  {
    key: 'buildings',
    label: 'Neutral Zone Rooms',
    caption: 'Which room each NZ door leads to',
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['No changes to the original game', 'NZ rooms are randomly shuffled, one reward room per NZ'],
    default: 'shuffled',
  },
  {
    key: 'zones',
    label: 'Neutral Zones',
    caption: 'Which NZ (O13-O19) is at each map number (13-19)',
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['No changes to the original game', 'NZ locations are randomly shuffled'],
    default: 'shuffled',
  },
  {
    key: 'areas',
    label: 'Enemy Areas',
    caption: 'Which enemy area (O1-O11) is at each map number (1-11)',
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['No changes to the original game', 'Enemy area locations are randomly shuffled'],
    default: 'shuffled',
  },
  {
    key: 'continues',
    label: 'Starting Continues',
    caption: 'Number of continues at the start of a game, normally 0',
    values: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'unlimited'],
    valueLabels: ['0 (vanilla)', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Unlimited'],
    default: 'unlimited',
    vanilla: '0',
  },
  {
    key: 'lives',
    label: 'Lives Per Game',
    caption: 'Number of lives at the start of a game and after each continue, normally 3',
    values: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
    valueLabels: ['1', '2', '3 (vanilla)', '4', '5', '6', '7', '8', '9', '10'],
    default: '3',
    vanilla: '3',
  },
  {
    key: 'mapSpeed',
    label: 'Map Travel Speed',
    caption: 'How fast the helicopter moves on the map',
    values: ['1', '2'],
    valueLabels: ['1x', '2x'],
    valueInfo: ['No change to the original speed', 'The helicopter moves at double speed; trucks keep their speed'],
    default: '2',
    vanilla: '1',
  },
  {
    key: 'markers',
    label: 'Map Markers',
    caption: "Marks on the map for areas you've visited or cleared",
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No change to the original map view', 'Visited areas are blue and cleared areas are green'],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'gateDisplay',
    label: 'Map Gates',
    caption: 'Visualize region gate logic (6↔8 & 8↔10) on the map',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: [
      'No change to the original map view',
      'Gated paths are shown in red, with obtained items shown in lower right',
    ],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'comms',
    label: 'Communicator Areas',
    caption: "Which communicator each enemy area's comm rooms use",
    values: ['vanilla', 'shuffled'],
    valueLabels: ['Vanilla', 'Shuffled'],
    valueInfo: ['No changes to the original game', 'Each communicator works in 2-3 random areas'],
    default: 'shuffled',
  },
  {
    key: 'hints',
    label: 'Routing Hints',
    caption: 'What communications, wiretaps, and NZ talkers tell you about the routing logic',
    values: ['vanilla', 'nonsense', 'terse', 'normal', 'verbose'],
    valueLabels: ['Vanilla', 'Nonsense', 'Terse', 'Normal', 'Verbose'],
    valueInfo: [
      'Original dialogue, adjusted for correctness',
      'No routing hints, just ridiculous dialogue',
      'Just enough hints to finish, often vague',
      'Enough hints to finish plus extras, sometimes vague',
      'Thorough routing hints, sometimes redundant',
    ],
    default: 'normal',
    vanilla: 'vanilla',
  },
  {
    key: 'story',
    label: 'Story Dialogue',
    caption: 'Dialogue used in montages and boss fights',
    values: ['vanilla', 'comedic'],
    valueLabels: ['Vanilla', 'Comedic'],
    valueInfo: ['No changes to original story dialogue', 'Humorous, randomly selected dialogue'],
    default: 'comedic',
  },
  {
    key: 'd1Portrait',
    label: 'D-1 Portrait',
    caption: 'A close-up portrait for D-1',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No portrait is shown for D-1', 'D-1 has a close-up portrait when talking'],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'pickupText',
    label: 'Pickup Messages',
    caption: 'Clarifying messages when picking up items from NZ rooms or the underground passage',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No message is shown when picking up an item', 'A clarifying message is shown when picking up an item'],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'typos',
    label: 'Fix Typos',
    caption: 'There are various spelling and grammar errors in the game\'s dialogue (e.g., "EXPLOD")',
    values: ['vanilla', 'fixed'],
    valueLabels: ['Off', 'On'],
    valueInfo: [
      'No changes are made to the original messages',
      'Spelling, grammar, and style improvements are applied',
    ],
    default: 'fixed',
  },
  {
    key: 'titleO',
    label: '0->O on Titles',
    caption: 'The title, CONTINUE and GAME OVER screens draw the letter O as a zero (CAPC0M, C0NTINUE, GAME 0VER)',
    values: ['vanilla', 'fixed'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No changes are made to the original texts', 'The 0 digits are replaced with O letters'],
    default: 'fixed',
  },
  {
    key: 'timer',
    label: 'Run Timer',
    caption: 'A run timer from START to the end of the escape',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: [
      'No run timer is provided',
      "A run time is shown after Ladd's last message and again on the final screen",
    ],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'rapidFire',
    label: 'Fix Rapid Fire',
    caption: 'In the original game, the Rapid Fire Device fires on a fixed 8-frame beat and drops taps',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No change to the original behavior', 'Every press fires at once and holding B repeats'],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'machineGun',
    label: 'Full-auto Machine Gun',
    caption: 'In the original game, the Machine Gun fires a 3-round burst per press of B',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['No change to the original behavior', 'Full-auto keeps firing while B is held'],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'topDownDrops',
    label: 'Top-Down Drops',
    caption: 'Bullet rewards from non-elite enemies in top-down stages (trucks and the underground passage)',
    values: ['off', 'on'],
    valueLabels: ['Off', 'On'],
    valueInfo: ['Non-elite enemies do not drop rewards', 'Non-elite enemies have a 1/3 chance of dropping a bullet'],
    default: 'on',
    vanilla: 'off',
  },
  {
    key: 'eagles',
    label: 'Top-Down Eagles',
    caption: 'The eagle pickup dropped by elite enemies in top-down stages (trucks and the underground passage)',
    values: ['vanilla', 'oneup', 'none'],
    valueLabels: ['Continue', '1-UP', 'Nothing'],
    valueInfo: [
      'Eagles give a continue (up to 9)',
      'Eagles give an extra life (up to 9)',
      'Elite enemies drop no eagle',
    ],
    default: 'oneup',
  },
  {
    key: 'turrets',
    label: 'Boss Turrets',
    caption: 'The gun turrets above boss room cores',
    values: ['vanilla', 'destructible'],
    valueLabels: ['Vanilla', 'Destructible'],
    valueInfo: ['Turrets cannot be damaged', 'Active turrets can be destroyed'],
    default: 'destructible',
  },
  {
    key: 'commLocks',
    label: 'Comm Locks',
    caption: 'Boss doors that stay locked until communicating',
    values: ['vanilla', 'more', 'all'],
    valueLabels: ['Vanilla', 'More', 'Most'],
    valueInfo: [
      'Areas O1, O4, & O8',
      'Vanilla plus 2-3 more random areas',
      'Areas O1-O5 & O8-O10 (12 has its own option)',
    ],
    default: 'more',
  },
];

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  GAMEPLAY_SCHEMA.map((o) => [o.key, o.default ?? o.values[0]]),
);
/** Preset "Iron": Standard with a longer, harder route and fewer safety nets. */
export const IRON_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  area12: 'joe+10+11',
  area12Comm: 'both',
  dark: 'true',
  darkAreas: 'more',
  depth: '6',
  hints: 'terse',
  trucks: 'on',
  continues: '0',
  eagles: 'vanilla',
  turrets: 'vanilla',
  commLocks: 'all',
};
/** Preset "Brute": Iron with Nonsense hints, no eagles, no top-down drops and 1x map speed. */
export const BRUTE_SETTINGS: Settings = {
  ...IRON_SETTINGS,
  hints: 'nonsense',
  eagles: 'none',
  continues: '0',
  topDownDrops: 'off',
  mapSpeed: '1',
};
/** Preset "Vanilla": every option as the original game plays. */
export const VANILLA_SETTINGS: Settings = Object.fromEntries(
  GAMEPLAY_SCHEMA.map((o) => [o.key, o.vanilla ?? 'vanilla']),
);

/** The presets' names (the final screen's RUN STYLE) and seed-code first chars (Iron's R: the alphabet has no I). */
const PRESETS: [name: string, letter: string, settings: Settings][] = [
  ['VANILLA', 'V', VANILLA_SETTINGS],
  ['STANDARD', 'S', DEFAULT_SETTINGS],
  ['IRON', 'R', IRON_SETTINGS],
  ['BRUTE', 'B', BRUTE_SETTINGS],
];
/** The first char of a custom code (every option in it). */
const CUSTOM_CODE = 'C';
/** The preset these settings are exactly. */
function presetOf(settings: Settings) {
  const s = normalizeSettings(settings);
  return PRESETS.find(([, , p]) => {
    const n = normalizeSettings(p);
    return GAMEPLAY_SCHEMA.every((o) => s[o.key] === n[o.key]);
  });
}

/** The final screen's "RUN STYLE": the preset the options are, else CUSTOM. */
export function runStyle(settings: Settings): string {
  return presetOf(settings)?.[0] ?? 'CUSTOM';
}

/** Options these settings make moot (key -> why); the generator ignores them. */
export function inertOptions(s: Settings): Map<string, string> {
  const out = new Map<string, string>();
  if (s.rewards === 'vanilla') {
    for (const k of ['pickups', 'depth', 'pathComm', 'rocket'])
      out.set(k, 'No effect with vanilla area-clear rewards: every item stays where it is.');
  } else if (s.gate === 'vanilla' && s.areas === 'vanilla') {
    out.set(
      'rocket',
      'No effect with the vanilla 6↔8 gate on vanilla layouts: the gate needs Area 6 cleared, whose boss needs the rocket.',
    );
  }
  return out;
}

/**
 * Option combinations no seed can satisfy, worked out in advance (an exhaustive sweep of every combination of the
 * options that shape the item logic). Each names the options involved.
 */
const CONFLICTS: { keys: string[]; when: (s: Settings) => boolean; why: string }[] = [
  {
    // (vanilla rewards fail with the IFF Code on every vanilla area layout and some shuffled ones: it takes a vanilla
    // reward that is usually past the gate it opens; the simple rule wins)
    keys: ['rewards', 'gate'],
    when: (s) => s.rewards === 'vanilla' && s.gate === 'iff',
    why: 'The IFF Code gate needs shuffled area clear rewards: with vanilla rewards it would usually sit past the gate it opens.',
  },
  {
    // (no seed of these reaches depth 3, all 384 of their combinations in the sweep, before Comm Locks; other shortfalls
    // are best-effort)
    keys: ['depth', 'area12', 'area12Comm', 'gate', 'flak', 'areas', 'commLocks'],
    when: (s) =>
      s.rewards !== 'vanilla' &&
      Number(s.depth) >= 3 &&
      s.area12 === 'vanilla' &&
      (s.area12Comm === 'none' || s.area12Comm === 'boss') &&
      s.gate === 'open' &&
      s.flak === 'open' &&
      s.areas === 'vanilla' &&
      s.commLocks === 'vanilla',
    why: 'Minimum Logic Depth 3 or more is out of reach with Area 12 Entry Vanilla, Area 12 Door Locks Open or Boss, both path gates Open, vanilla Enemy Areas and Comm Locks Vanilla.',
  },
];

/** The conflicts these settings fall into. */
export function conflicts(s: Settings) {
  return CONFLICTS.filter((c) => c.when(s));
}

/** The other options that conflict with `key` as set in `s` (empty: no conflict). */
export function blockers(s: Settings, key: string): string[] {
  return [
    ...new Set(
      conflicts(s)
        .filter((c) => c.keys.includes(key))
        .flatMap((c) => c.keys.filter((k) => k !== key)),
    ),
  ];
}

/** Preset "Chaos": every option at random (no conflicting combination); options the rest make moot stay vanilla. */
export function chaosSettings(): Settings {
  for (;;) {
    const s = randomSettings();
    for (const k of inertOptions(s).keys()) s[k] = VANILLA_SETTINGS[k];
    if (!conflicts(s).length && [...inertOptions(s).keys()].every((k) => s[k] === VANILLA_SETTINGS[k])) return s;
  }
}

/** Every option at random. */
function randomSettings(): Settings {
  return Object.fromEntries(GAMEPLAY_SCHEMA.map((o) => [o.key, o.values[Math.floor(Math.random() * o.values.length)]]));
}

/** 5 bits per character, uppercase letters and digits without I, O, 0 and 1 (the game's font has no
 * lowercase, so the final screen can show the code; easier to read out too). Input is case-insensitive. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAR_BITS = 5;
const SEED_BITS = 54;
/** Vanilla's code: nothing in it is random, so there is just the one (the V + seed form still reads as Vanilla). */
export const VANILLA_CODE = 'VANILLA';
const bitsFor = (n: number) => Math.max(1, Math.ceil(Math.log2(n)));

/** Fill missing options with defaults; reject unknown keys/values. */
export function normalizeSettings(input: Settings): Settings {
  const s = { ...DEFAULT_SETTINGS, ...input };
  for (const key of Object.keys(s)) {
    const o = GAMEPLAY_SCHEMA.find((x) => x.key === key);
    if (!o) throw new Error(`Unknown setting "${key}"`);
    if (!o.values.includes(s[key])) throw new Error(`Unknown value "${s[key]}" for ${key}`);
  }
  return s;
}

/** A value's index counted from the option's vanilla value (so the Vanilla preset encodes as zero bits: all "A"s), and back. */
const encodeIndex = (o: OptionSchema, i: number) =>
  (i - o.values.indexOf(VANILLA_SETTINGS[o.key]) + o.values.length) % o.values.length;
const decodeIndex = (o: OptionSchema, e: number) => (e + o.values.indexOf(VANILLA_SETTINGS[o.key])) % o.values.length;

/** Encode settings + a seed (bigint < 2^54) as a seed code. */
export function makeSeedCode(settings: Settings, seed: bigint): string {
  const s = normalizeSettings(settings);
  if (seed < 0n || seed >= 1n << BigInt(SEED_BITS)) throw new Error('seed out of range');
  let bits = seed.toString(2).padStart(SEED_BITS, '0');
  const preset = presetOf(s);
  if (preset?.[2] === VANILLA_SETTINGS) return VANILLA_CODE;
  if (!preset)
    for (const o of GAMEPLAY_SCHEMA)
      bits += encodeIndex(o, o.values.indexOf(s[o.key])).toString(2).padStart(bitsFor(o.values.length), '0');
  bits = bits.padEnd(Math.ceil(bits.length / CHAR_BITS) * CHAR_BITS, '0');
  let out = preset?.[1] ?? CUSTOM_CODE;
  for (let i = 0; i < bits.length; i += CHAR_BITS) out += ALPHABET[parseInt(bits.slice(i, i + CHAR_BITS), 2)];
  return out;
}

export function randomSeedValue(): bigint {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  return ((BigInt(buf[0]) << 32n) | BigInt(buf[1])) & ((1n << BigInt(SEED_BITS)) - 1n);
}

/** A fresh seed code for the given gameplay settings. */
export function newSeedCode(settings: Settings = DEFAULT_SETTINGS): string {
  return makeSeedCode(settings, randomSeedValue());
}

export function parseSeedCode(code: string): { settings: Settings; seed: bigint } {
  const c = code.trim().toUpperCase();
  const bad = () => new Error(`Not a valid seed code: "${code}"`);
  if (c === VANILLA_CODE) return { settings: { ...VANILLA_SETTINGS }, seed: 0n };
  const preset = PRESETS.find(([, letter]) => letter === c[0]);
  if (!preset && c[0] !== CUSTOM_CODE) throw bad();
  let bits = '';
  for (const ch of c.slice(1)) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw bad();
    bits += v.toString(2).padStart(CHAR_BITS, '0');
  }
  if (bits.length < SEED_BITS) throw bad();
  const seed = BigInt(`0b${bits.slice(0, SEED_BITS)}`);
  if (preset) {
    if (bits.slice(SEED_BITS).includes('1')) throw bad();
    return { settings: { ...preset[2] }, seed };
  }
  let p = SEED_BITS;
  const settings: Settings = { ...DEFAULT_SETTINGS };
  for (const o of GAMEPLAY_SCHEMA) {
    const n = bitsFor(o.values.length);
    if (p + n > bits.length) break; // older code: remaining options default
    const idx = parseInt(bits.slice(p, p + n), 2);
    if (idx >= o.values.length) throw bad();
    settings[o.key] = o.values[decodeIndex(o, idx)];
    p += n;
  }
  if (bits.slice(p).includes('1')) throw new Error(`Seed code "${code}" is from a newer version of the randomizer`);
  return { settings, seed };
}
