import type { AbilityCardDefinition, EffectDefinition } from '../types.js';

// Curated launch wording stays readable; numeric rules are checked against effect data.
export function rulesTextMatches(card: AbilityCardDefinition): boolean {
  const text = card.description;
  const matches = (effect: EffectDefinition): boolean => {
    switch (effect.type) {
      case 'neutral':
        return text === 'No board change.';
      case 'heal':
      case 'heal_all':
        return text.includes(`+${effect.amount} health`);
      case 'extra_actions':
        return new RegExp(
          `Gain ${effect.amount} (?:additional|extra) actions?`,
        ).test(text);
      case 'damage':
        return text.includes(`Deal ${effect.amount} damage`);
      case 'area_damage':
        return (
          text.includes(`${effect.size}×${effect.size}`) &&
          text.includes(`takes ${effect.amount} damage once`)
        );
      case 'build_free':
        return (
          text.includes(`${effect.health}-health tower`) &&
          text.includes('for free')
        );
      case 'expand_free': {
        const target = card.targets.find((t) => t.id === effect.cellsTarget);
        return (
          !!target &&
          new RegExp(`(?:by up to|up to|by) ${target.count} cells?`).test(
            text,
          ) &&
          text.includes('for free')
        );
      }
      case 'random_reveal':
        return text.includes(`Reveal ${effect.amount} random hidden cells`);
      case 'reveal': {
        if (effect.mode === 'rectangle')
          return text.includes(`${effect.size}×${effect.size}`);
        if (effect.mode === 'neighbors_if_occupied')
          return (
            text.includes('If occupied') &&
            text.includes('orthogonal neighbors')
          );
        if (effect.mode === 'row_column')
          return text.includes('row') && text.includes('column');
        if (effect.mode === 'quadrant') return text.includes('entire quadrant');
        const target = card.targets.find((t) => t.id === effect.target);
        return (
          target?.kind === 'connected_enemy_cells' &&
          text.includes(
            `Reveal ${target.count} orthogonally connected enemy cells`,
          )
        );
      }
      case 'prevent_damage':
        return false; // Legacy text uses describeEffects instead.
      case 'modifier': {
        switch (effect.kind) {
          case 'shield':
            return new RegExp(`next ${effect.amount} (?:total )?damage`).test(
              text,
            );
          case 'invulnerable':
            return text.includes('cannot take damage');
          case 'phoenix':
            return text.includes(`survives with ${effect.amount} health`);
          case 'free_expand':
          case 'free_build_expand':
            return text.includes('costs no action');
          case 'build_health':
            return text.includes(
              `with ${1 + effect.amount} health instead of 1`,
            );
          case 'momentum':
            return text.includes(`+${effect.amount} health`);
          case 'spotter':
            return text.includes('orthogonal neighbors');
          case 'attack_bonus':
            return new RegExp(`deals? ${1 + effect.amount} damage`).test(text);
          case 'target_bonus':
          case 'focused_fire':
            return text.includes(`+${effect.amount} damage`);
          case 'destroy_attack':
            return (
              effect.amount === 1 &&
              /gain (?:1|a) free Attack/.test(text) &&
              (card.charges === 1
                ? text.includes('first time')
                : text.includes(`up to ${card.charges} times`))
            );
          case 'counterintelligence':
            return (
              effect.amount === 1 &&
              text.includes('reveal a random hidden cell')
            );
        }
      }
    }
  };
  return card.effects.every(matches);
}
