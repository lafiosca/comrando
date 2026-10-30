// The spoiler file's shape: data for tools and tests, not prose (the visual spoiler is
// for people). Places are numbers (map number and layout), items their ITEMS ids; the route (RouteEntry) stays the visual
// spoiler's text, and dialogue is the lines as said.
import type { DESTROYER_POSITIONS } from './destroyers.ts';
import type { Item } from './world.ts';

/** An area or zone: `area` its map number (where it sits), `layout` the O-number of the level there. */
export interface Place {
  area: number;
  layout: number;
}

/** A line as said: who says it (when the scene has several speakers), the text with its line breaks. */
export interface Said {
  speaker?: 'hq' | 'officer' | 'ladd' | 'boss' | 'joe' | 'killt' | 'masterD' | 'hal';
  text: string;
}

/** An item location: its id (world.ts: clearN, roomNN, destroyer, passage, interrogation), where, what it holds. */
export interface SpoilerReward extends Partial<Place> {
  location: string;
  /** The building door (rooms, and the interrogation room). */
  door?: 'A' | 'B';
  item: Item;
}

/** A building and what's behind its door. */
export interface SpoilerBuilding extends Place {
  door: 'A' | 'B';
  room: number;
  contents: 'item' | 'bullets' | 'informer' | 'interrogation' | 'destroyer';
  item?: Item;
  bullets?: number;
}

/** A hint (or with Nonsense, whatever a hint slot says instead). */
export interface SpoilerHint extends Partial<Place> {
  kind: 'comm' | 'wiretap' | 'talker' | 'joePointer' | 'joeRescue' | 'nonsense';
  /** The comm room (O1A: 'A') or the building door. */
  room?: 'A' | 'B';
  door?: 'A' | 'B';
  /** The man inside the building, not the one at its door. */
  inside?: boolean;
  /** Nonsense: the slot's name. */
  slot?: string;
  lines: Said[];
}

export type SceneId =
  | 'escapeCyborg'
  | 'ending'
  | 'cockpit'
  | 'hal'
  | 'selfDestruct'
  | 'joeRescue'
  | 'outsideBase'
  | 'missionReport'
  | 'escapeRadio'
  | 'joeLetter';

/** Comedic or Nonsense story dialogue (option "Story Dialogue"). */
export interface SpoilerDialogue {
  /** Each boss's taunt, and the line after its defeat (by the boss or Ladd). */
  bosses: (Place & { line: string; reply?: Said })[];
  scenes: Partial<Record<SceneId, Said[]>>;
}

// --- the route (hints.ts intendedRoute, oracle.ts): visits as data; routetext.ts says them in English ---

/** Where a route visit is. */
export type RoutePlace =
  | { kind: 'briefing' }
  | { kind: 'start' }
  | { kind: 'passage' }
  | ({ kind: 'area' | 'zone' } & Place);

/** Where the player learned something: a route step (entry and step index; the page calls it "4c"), or, when no step
 * of the route reads it, the briefing, Joe's rescue line, or a hint slot by id ("O4A", "NZ15 door B talker"). */
export type Source =
  | { kind: 'step'; entry: number; step: number }
  | { kind: 'briefing' }
  | { kind: 'joeRescue' }
  | { kind: 'slot'; slot: string };

/** A clue as the player read it: its sources, and how vague it was ("somewhere in the west", "Area 3 or 7"). */
export interface Clue {
  by: Source[];
  vague?: { region: 'west' | 'central' | 'compound'; areas: [number, number] } | { either: [number, number] };
}

/** One reason a visit happens (a visit's reasons are shown in order). */
export type Why =
  | { kind: 'suggested'; clues: Clue[] }
  | { kind: 'onTheWay'; to?: RoutePlace }
  | { kind: 'lookingAround' }
  | { kind: 'finishing' }
  | { kind: 'trial' }
  | { kind: 'area12Entry' }
  | { kind: 'byPassage' }
  | { kind: 'flownFrom'; place: RoutePlace }
  | { kind: 'returnWith'; items: (Item | 'anotherComm' | 'destroyerName')[] }
  | { kind: 'searchingForJoe'; by: Source[] };

/** How the player knows a requirement. */
export type Basis =
  | { kind: 'per'; by: Source[] }
  | { kind: 'trial' }
  | { kind: 'checkArea' }
  | { kind: 'settings' }
  | { kind: 'flareless' }
  | { kind: 'none' };

/** What a visit takes: an item, an area cleared, or one of the special notes. `struck`: what a full route would wait for
 * and this one goes without (the oracle's Flareless). */
export interface RouteNeed {
  need: { item: Item } | { cleared: number } | { special: 'noComm' | 'commUnknown' | 'destroyerIntel' | 'hp3' };
  basis: Basis;
  struck?: boolean;
}

/** What opens when a comm room answers, or a miniboss falls. */
export type Opens = 'door' | 'bossDoor' | 'powerA' | 'powerB' | 'minibossDoor';

/** Something the player can't do yet (a probe's target). */
export type ProbeTarget =
  | { kind: 'enter' }
  | { kind: 'room'; door: 'A' | 'B'; prisoner?: boolean }
  | { kind: 'talk'; door: 'A' | 'B'; inside: boolean }
  | { kind: 'destroyerRooms' }
  | { kind: 'comm'; room: 'A' | 'B' }
  | { kind: 'secondHalf' };

/** One thing done (or tried) at a visit. `quote`: the line as the ROM says it. */
export type RouteAction =
  | { act: 'start'; item: Item }
  | { act: 'briefing'; quote: string }
  | { act: 'comm' | 'wiretap'; room: 'A' | 'B'; quote?: string; opens?: Opens }
  | { act: 'talk'; door: 'A' | 'B'; inside: boolean; quote?: string }
  | { act: 'room'; door: 'A' | 'B'; prisoner?: boolean; item?: Item; bullets?: number }
  /** Saying YES to the real Destroyer: by name, or with Nonsense hints (no names) by where he stands; `by` how the player
   * knows him (none on the oracle route). */
  | {
      act: 'destroyer';
      door: 'A' | 'B';
      name?: string;
      position: (typeof DESTROYER_POSITIONS)[number];
      by?: Source[] | 'trial';
      item: Item;
    }
  | { act: 'clear'; item: Item; trail?: boolean }
  | { act: 'passage'; item: Item }
  | { act: 'probe'; target: ProbeTarget; needs: Item[] | 'anotherComm' | 'destroyerName' }
  | { act: 'destroy'; target: 'powerA' | 'powerB' }
  | { act: 'defeat'; target: 'miniboss' | 'masterD'; opens?: Opens }
  | { act: 'escape' };

/** A step of a visit: `optional` the player could skip it (shown in italics), `extra` the win didn't need it. */
export type RouteStep = RouteAction & { optional?: boolean; extra?: boolean };

/** One visit of the route: where, why, what it takes, what's done there. */
export interface RouteVisit {
  place: RoutePlace;
  why: Why[];
  needs: RouteNeed[];
  steps: RouteStep[];
}
