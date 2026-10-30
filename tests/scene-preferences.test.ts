import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scenePreferences } from '../src/lib/scene-preferences.ts';

test('scene quality adapts to mobile devices unless the account chooses a quality explicitly', () => {
  const desktop = { coarsePointer: false, smallScreen: false, reducedMotion: false };
  assert.deepEqual(scenePreferences(undefined, desktop), { lowQuality: false, animate: true });
  assert.equal(scenePreferences(undefined, { ...desktop, coarsePointer: true }).lowQuality, true);
  assert.equal(scenePreferences(undefined, { ...desktop, smallScreen: true }).lowQuality, true);
  assert.equal(
    scenePreferences(
      { graphicsQuality: 'high', reducedMotion: false },
      { ...desktop, coarsePointer: true },
    ).lowQuality,
    false,
  );
  assert.equal(
    scenePreferences({ graphicsQuality: 'low', reducedMotion: false }, desktop).lowQuality,
    true,
  );
});

test('either the operating system or the personal preference disables scene movement', () => {
  const desktop = { coarsePointer: false, smallScreen: false, reducedMotion: false };
  assert.equal(
    scenePreferences({ graphicsQuality: 'high', reducedMotion: true }, desktop).animate,
    false,
  );
  assert.equal(
    scenePreferences(
      { graphicsQuality: 'low', reducedMotion: false },
      { ...desktop, reducedMotion: true },
    ).animate,
    false,
  );
  assert.equal(scenePreferences(undefined, { ...desktop, reducedMotion: true }).animate, false);
});
