import type { Balance } from '../../types.js';
export const rarityAnchors = [
  { progress: 0, weights: [80, 20, 0, 0, 0] },
  { progress: 0.2, weights: [55, 35, 10, 0, 0] },
  { progress: 0.4, weights: [35, 35, 23, 7, 0] },
  { progress: 0.6, weights: [20, 30, 30, 18, 2] },
  { progress: 0.8, weights: [10, 20, 30, 32, 8] },
  { progress: 0.95, weights: [5, 15, 25, 40, 15] },
  { progress: 1, weights: [5, 15, 25, 40, 15] },
];
export const launchBalance: Balance = {
  version: 'launch-2',
  rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'].map(
    (id, rank) => ({
      id,
      rank,
      label: id[0]!.toUpperCase() + id.slice(1),
      icon: ['circle', 'diamond', 'star', 'shield', 'crown'][rank]!,
      color: ['#94a3b8', '#34d399', '#60a5fa', '#c084fc', '#fbbf24'][rank]!,
      unlockProgress: 0,
      weights: rarityAnchors.map((a) => ({
        progress: a.progress,
        weight: a.weights[rank]!,
      })),
    }),
  ),
};
