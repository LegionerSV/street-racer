import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { vehicleGroundPose, wheelSurfaceY } from './vehicle-grounding';
import { VEHICLE_PROFILES } from './vehicle-profiles';

it('каждый расчёт опоры заново измеряет все колёса после изменения поверхности', () => {
  // Arrange
  const profile = VEHICLE_PROFILES['city-sedan'];
  let height = 3, calls = 0;
  const surface = () => { calls++; return height; };
  // Act
  const before = vehicleGroundPose(profile, { x: 0, y: 3, z: 0 }, 0, surface);
  height = 15;
  const after = vehicleGroundPose(profile, { x: 0, y: 15, z: 0 }, 0, surface);
  // Assert
  expect(calls).toBe(16);
  expect(before.y).toBeCloseTo(3 + profile.rideHeight, 10);
  expect(after.y).toBeCloseTo(15 + profile.rideHeight, 10);
});

it('вложенный расчёт опоры не портит промежуточные координаты внешнего', () => {
  // Arrange
  const profile = VEHICLE_PROFILES['city-sedan'];
  const point = { x: 5, y: 3, z: 9 }, surface = (x: number, z: number) => 3 + x * 0.1 + z * 0.15;
  const expected = vehicleGroundPose(profile, point, 0.7, surface);
  // Act
  const actual = vehicleGroundPose(profile, point, 0.7, (x, z) => {
    vehicleGroundPose(VEHICLE_PROFILES['sport-coupe'], { x: 0, y: 10, z: 0 }, 1.2, () => 10);
    return surface(x, z);
  });
  // Assert
  expect(actual).toEqual(expected);
});

it.each([
  ['ровная дорога', 0, 0],
  ['подъём', 0, 0.18],
  ['спуск', 0, -0.18],
  ['поперечный уклон', 0.12, 0],
  ['смешанный уклон', 0.1, 0.15],
] as const)('колёса опираются на покрытие: %s', (_, sx, sz) => {
  // Arrange
  const profile = VEHICLE_PROFILES['city-sedan'];
  const surface = (x: number, z: number) => 3 + sx * x + sz * z;
  // Act
  const pose = vehicleGroundPose(
    profile,
    { x: 5, y: surface(5, 9), z: 9 },
    0.7,
    surface,
  );
  const rotation = Quaternion.RotationYawPitchRoll(0.7, pose.pitch, pose.roll);
  // Assert
  for (const z of [profile.wheelbase / 2, -profile.wheelbase / 2])
    for (const x of [-profile.track / 2, profile.track / 2]) {
      const wheel = new Vector3(
        x,
        -profile.rideHeight + profile.wheelRadius,
        z,
      ).applyRotationQuaternion(rotation);
      expect(
        wheelSurfaceY(
          pose.y,
          wheel.y,
          profile.wheelRadius,
          pose.pitch,
          pose.roll,
        ),
      ).toBeCloseTo(surface(5 + wheel.x, 9 + wheel.z), 2);
    }
});

it.each(['empty', 'partial', 'error', 'unknown'] as const)(
  'не получает NaN при состоянии поверхности %s',
  (state) => {
    // Arrange
    const profile = VEHICLE_PROFILES['city-sedan'];
    const surface = (x: number, z: number): number | undefined => {
      if (state === 'error') return NaN;
      if (state === 'partial') return z > 0 ? 6 : undefined;
      if (state === 'unknown') return Infinity;
      return undefined;
    };
    // Act
    const pose = vehicleGroundPose(profile, { x: 0, y: 6, z: 0 }, 0, surface);
    // Assert
    expect(pose.y).toBeCloseTo(6 + profile.rideHeight);
    expect(pose.pitch).toBe(0);
    expect(pose.roll).toBe(0);
  },
);
