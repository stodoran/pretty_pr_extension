import type { Feature } from '../core/feature';
import { autoViewTests } from './auto-view-tests';
import { definitionSearch } from './definition-search';
import { formatting } from './formatting';
import { movedCode } from './moved-code';
import { readableJson } from './readable-json';

/** Register new features here (and add their settings in core/settings.ts). */
export const FEATURES: Feature[] = [autoViewTests, movedCode, formatting, definitionSearch, readableJson];
