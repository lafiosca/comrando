// Cosmetic options: personal taste, not part of the seed code and never drawn from the gameplay RNG.

import { ENEMY_COLORS, HAIR_COLORS, UNIFORM_COLORS } from './palette.ts';

export interface Cosmetics {
  uniformColor: string; // preset key (the first is the vanilla color) | 'random'
  hairColor: string;
  enemyColor: string;
}

export const DEFAULT_COSMETICS: Cosmetics = { uniformColor: 'lime', hairColor: 'auburn', enemyColor: 'raspberry' }; // vanilla colors

/** Random first, then the vanilla color, then the rest alphabetically. */
const withRandom = ([vanilla, ...rest]: string[]) => ['random', vanilla, ...rest.sort()];

export const COSMETIC_CHOICES: Record<keyof Cosmetics, readonly string[]> = {
  uniformColor: withRandom(Object.keys(UNIFORM_COLORS)),
  hairColor: withRandom(Object.keys(HAIR_COLORS)),
  enemyColor: withRandom(Object.keys(ENEMY_COLORS)),
};
const COLOR_KEYS = ['uniformColor', 'hairColor', 'enemyColor'] as const;

export function normalizeCosmetics(input: Partial<Cosmetics>): Cosmetics {
  const c = { ...DEFAULT_COSMETICS, ...input };
  for (const key of COLOR_KEYS) if (c[key] === 'vanilla') c[key] = DEFAULT_COSMETICS[key]; // (older name)
  // (older names: magenta $15; the uniform's forest green $1A and gray $00, the hair's yellow $28 and gray $10)
  const OLD: Record<string, string> = { magenta: 'raspberry', 'forest green': 'green', yellow: 'gold' };
  for (const key of COLOR_KEYS) {
    if (OLD[c[key]]) c[key] = OLD[c[key]];
    if (c[key] === 'gray') c[key] = key === 'hairColor' ? 'grey' : 'charcoal';
  }
  for (const key of Object.keys(COSMETIC_CHOICES) as (keyof Cosmetics)[]) {
    if (!COSMETIC_CHOICES[key].includes(c[key])) throw new Error(`Unknown ${key} "${c[key]}"`);
  }
  return c;
}
