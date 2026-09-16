import { expect, it } from 'vitest';
import { engineAudioState } from './audio';

it('добавляет ветер, шины и занос, не меняя базовую громкость двигателя', () => {
  // Arrange / Act
  const calm = engineAudioState({
    speed: 0,
    throttle: false,
    slip: 0,
    offRoad: false,
    wetness: 0,
  });
  const fast = engineAudioState({
    speed: 40,
    throttle: true,
    slip: 0.5,
    offRoad: true,
    wetness: 0.6,
  });

  // Assert
  expect(calm.engineGain).toBe(0.5);
  expect(fast.engineGain).toBe(1);
  expect(fast.windGain).toBeGreaterThan(calm.windGain);
  expect(fast.tyreGain).toBeGreaterThan(calm.tyreGain);
  expect(fast.tyreFrequency).toBeGreaterThan(calm.tyreFrequency);
});
