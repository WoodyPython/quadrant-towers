import type { Balance } from '../../types.js';

// Framework fixtures, not the release balance (milestone 5).
export const frameworkBalance: Balance = {
  version: 'framework-1',
  rarities: [
    {
      id: 'common',
      rank: 0,
      label: 'Common',
      icon: 'circle',
      color: '#64748b',
      unlockProgress: 0,
      weights: [
        { progress: 0, weight: 100 },
        { progress: 1, weight: 20 },
      ],
    },
    {
      id: 'uncommon',
      rank: 1,
      label: 'Uncommon',
      icon: 'diamond',
      color: '#16a34a',
      unlockProgress: 0,
      weights: [
        { progress: 0, weight: 20 },
        { progress: 1, weight: 30 },
      ],
    },
    {
      id: 'rare',
      rank: 2,
      label: 'Rare',
      icon: 'star',
      color: '#2563eb',
      unlockProgress: 0.25,
      weights: [
        { progress: 0, weight: 0 },
        { progress: 1, weight: 25 },
      ],
    },
    {
      id: 'epic',
      rank: 3,
      label: 'Epic',
      icon: 'sun',
      color: '#9333ea',
      unlockProgress: 0.5,
      weights: [
        { progress: 0, weight: 0 },
        { progress: 1, weight: 15 },
      ],
    },
    {
      id: 'legendary',
      rank: 4,
      label: 'Legendary',
      icon: 'crown',
      color: '#d97706',
      unlockProgress: 0.8,
      weights: [
        { progress: 0, weight: 0 },
        { progress: 1, weight: 10 },
      ],
    },
  ],
};
