import { SefariaProvider } from './SefariaProvider';
import { CachingTorahTextProvider } from './CachingTorahTextProvider';
import type { TorahTextProvider } from './TorahTextProvider';

export * from './TorahTextProvider';
export * from './readingContent';
export * from './prefetch';
export * from './commentaryData';

let instance: TorahTextProvider | null = null;

/** Singleton offline-caching Sefaria-backed provider used across the app. */
export function getDefaultTorahProvider(): TorahTextProvider {
  if (!instance) {
    instance = new CachingTorahTextProvider(new SefariaProvider());
  }
  return instance;
}
