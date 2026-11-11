import type { Feature } from '../core/feature';
import { autoViewTests } from './auto-view-tests';
import { definitionSearch } from './definition-search';
import { movedCode } from './moved-code';

/** Register new features here (and add their settings in core/settings.ts). */
export const FEATURES: Feature[] = [autoViewTests, movedCode, definitionSearch];
