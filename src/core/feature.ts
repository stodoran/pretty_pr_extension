import type { DiffDomAdapter } from '../github/dom/adapter';
import type { PrPage } from '../github/pr';
import type { FeatureId, Settings } from './settings';
import type { StatusDock } from './ui/status-dock';

export interface FeatureContext {
  page: PrPage;
  settings: Settings;
  dom: DiffDomAdapter;
  /** Feature-scoped status line in the floating dock. */
  status: ReturnType<StatusDock['scope']>;
  /** Aborted when the user navigates away (or the extension is reloaded); clean up on it. */
  signal: AbortSignal;
  /** Route errors from un-awaited async work (event handlers etc.) here instead of `void`-ing them. */
  reportError: (err: unknown) => void;
}

export interface Feature {
  id: FeatureId;
  /** Cheap URL-level check. */
  appliesTo(page: PrPage): boolean;
  run(ctx: FeatureContext): Promise<void>;
}
