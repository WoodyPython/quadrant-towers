export * from './types.js';
export * from './board.js';
export * from './engine.js';
export * from './projection.js';
export * from './scoring.js';
export * from './cards/registry.js';
export { frameworkCatalog } from './cards/catalog/v1.js';
export { frameworkBalance } from './cards/balance/v1.js';

import { createRegistry } from './cards/registry.js';
import { frameworkCatalog } from './cards/catalog/v1.js';
import { frameworkBalance } from './cards/balance/v1.js';
export const defaultRegistry = createRegistry(
  [frameworkCatalog],
  [frameworkBalance],
);
