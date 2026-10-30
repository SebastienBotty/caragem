import type { AccountPreferences } from './account-preferences.ts';

export function scenePreferences(
  preferences: Pick<AccountPreferences, 'graphicsQuality' | 'reducedMotion'> | undefined,
  environment: { coarsePointer: boolean; smallScreen: boolean; reducedMotion: boolean },
) {
  const quality = preferences?.graphicsQuality ?? 'auto';
  return {
    lowQuality:
      quality === 'low' ||
      (quality === 'auto' && (environment.coarsePointer || environment.smallScreen)),
    animate: !preferences?.reducedMotion && !environment.reducedMotion,
  };
}
