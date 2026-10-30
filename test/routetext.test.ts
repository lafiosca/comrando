import { describe, expect, it } from 'vitest';
import { abridge, renderRoute } from '../src/core/routetext.ts';
import type { RouteVisit } from '../src/core/spoiler.ts';

// A small route covering each kind of reason, requirement and step, and how the page words it.
const ROUTE: RouteVisit[] = [
  {
    place: { kind: 'briefing' },
    why: [],
    needs: [],
    steps: [
      { act: 'start', item: 'alpha' },
      { act: 'briefing', quote: 'THERE ARE MANY AGENTS IN AREA 3 NOW.' },
    ],
  },
  {
    place: { kind: 'zone', area: 17, layout: 13 },
    why: [{ kind: 'onTheWay' }],
    needs: [],
    steps: [
      {
        act: 'talk',
        door: 'A',
        inside: false,
        quote: 'OUR SCOUTS SAW THE FLARE IN AREA 5.',
        extra: true,
        optional: true,
      },
      { act: 'room', door: 'B', bullets: 11, optional: true, extra: true },
      { act: 'probe', target: { kind: 'secondHalf' }, needs: ['machine'] },
    ],
  },
  {
    place: { kind: 'area', area: 3, layout: 1 },
    why: [{ kind: 'suggested', clues: [{ by: [{ kind: 'step', entry: 0, step: 1 }] }] }],
    needs: [
      { need: { item: 'alpha' }, basis: { kind: 'per', by: [{ kind: 'step', entry: 0, step: 0 }] } },
      { need: { item: 'iff' }, basis: { kind: 'settings' } },
    ],
    steps: [
      { act: 'comm', room: 'A', quote: 'HELLO.', opens: 'door' },
      { act: 'wiretap', room: 'B' },
      { act: 'clear', item: 'flare', trail: true },
    ],
  },
  {
    place: { kind: 'area', area: 5, layout: 4 },
    why: [
      { kind: 'returnWith', items: ['machine', 'anotherComm'] },
      { kind: 'onTheWay', to: { kind: 'passage' } },
    ],
    needs: [
      { need: { special: 'noComm' }, basis: { kind: 'trial' } },
      { need: { item: 'flare' }, basis: { kind: 'flareless' }, struck: true },
    ],
    steps: [{ act: 'probe', target: { kind: 'comm', room: 'A' }, needs: 'anotherComm' }],
  },
  {
    place: { kind: 'passage' },
    why: [
      {
        kind: 'suggested',
        clues: [
          {
            by: [
              { kind: 'step', entry: 2, step: 1 },
              { kind: 'step', entry: 1, step: 0 },
            ],
            vague: { region: 'west', areas: [1, 6] },
          },
        ],
      },
      { kind: 'flownFrom', place: { kind: 'zone', area: 17, layout: 13 } },
    ],
    needs: [],
    steps: [{ act: 'passage', item: 'threeway' }],
  },
  {
    place: { kind: 'zone', area: 19, layout: 18 },
    why: [{ kind: 'searchingForJoe', by: [{ kind: 'slot', slot: 'O4A' }] }, { kind: 'area12Entry' }],
    needs: [{ need: { special: 'destroyerIntel' }, basis: { kind: 'per', by: [{ kind: 'joeRescue' }] } }],
    steps: [
      {
        act: 'destroyer',
        door: 'B',
        name: 'FLYNN',
        position: 'right of door B',
        by: [{ kind: 'step', entry: 2, step: 0 }],
        item: 'flak',
      },
      { act: 'destroyer', door: 'A', position: 'by door A', by: 'trial', item: 'joe' },
    ],
  },
];

describe('the route in words', () => {
  it('says every reason, requirement and step', () => {
    expect(renderRoute(ROUTE)).toEqual([
      {
        place: 'Briefing',
        why: '',
        requirements: [],
        steps: [
          { text: 'Start with', reward: 'α Communicator' },
          { text: '', quote: 'THERE ARE MANY AGENTS IN AREA 3 NOW.' },
        ],
      },
      {
        place: 'NZ17',
        layout: 'O13',
        why: 'on the way',
        requirements: [],
        steps: [
          { text: 'Talk outside A', quote: 'OUR SCOUTS SAW THE FLARE IN AREA 5.', optional: true, extra: true },
          { text: 'Room B: obtain', reward: '11 bullets', optional: true, extra: true },
          { text: 'Second half: needs', reward: 'Machine Gun', blocked: true },
        ],
      },
      {
        place: 'Area 3',
        layout: 'O1',
        why: 'suggested by 0b',
        requirements: [
          { item: 'α Communicator', why: 'per 0a' },
          { item: 'IFF Code', why: 'per seed settings' },
        ],
        steps: [
          { text: 'Comm A', quote: 'HELLO.', note: 'opens door' },
          { text: 'Wiretap B' },
          { text: 'Clear area: obtain', reward: 'Flare', note: 'Joe was moved' },
        ],
      },
      {
        place: 'Area 5',
        layout: 'O4',
        why: 'return with Machine Gun and another communicator, on the way to the underground passage',
        requirements: [
          { item: 'No communicator needed', why: 'trial and error' },
          { item: 'Flare', why: 'Flareless', struck: true },
        ],
        steps: [{ text: 'Comm A: needs', reward: 'another communicator', blocked: true }],
      },
      {
        place: 'Underground passage',
        why: 'suggested by 1a & 2b: somewhere in the west, Areas 1-6, flown from NZ17 (O13)',
        requirements: [],
        steps: [{ text: 'Clear passage: obtain', reward: '3-Way Gun' }],
      },
      {
        place: 'NZ19',
        layout: 'O18',
        why: 'searching for Joe per O4A comm, required for Area 12 entry',
        requirements: [{ item: 'Destroyer intel', why: "per Super Joe's rescue line" }],
        steps: [
          { text: 'Room B, say YES to FLYNN (per 2a): obtain', reward: 'Flak Map' },
          { text: 'Room A, say YES to the man by door A (trial and error): obtain', reward: 'Super Joe' },
        ],
      },
    ]);
  });

  it("abridged: without what the win didn't need, the cited steps renumbered", () => {
    const short = abridge(ROUTE);
    expect(short[1].steps.map((s) => s.act)).toEqual(['probe']);
    // (2b, the wiretap, is still 2b; the passage's 1a is NZ17's talker, gone: it keeps its number)
    expect(renderRoute(short)[4].why).toBe(
      'suggested by 1a & 2b: somewhere in the west, Areas 1-6, flown from NZ17 (O13)',
    );
    const noZone = abridge([ROUTE[0], { ...ROUTE[1], steps: ROUTE[1].steps.slice(0, 2) }, ...ROUTE.slice(2)]);
    expect(noZone.map((v) => v.place.kind)).toEqual(['briefing', 'area', 'area', 'passage', 'zone']);
    // (the wiretap, 2b, is now 1b; the zone's talker, 1a, is gone and keeps its old number; in route order)
    expect(renderRoute(noZone)[3].why).toBe(
      'suggested by 1a & 1b: somewhere in the west, Areas 1-6, flown from NZ17 (O13)',
    );
    expect(renderRoute(noZone)[4].steps[0].text).toBe('Room B, say YES to FLYNN (per 1a): obtain');
  });
});
