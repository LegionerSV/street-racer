import { expect, it } from 'vitest';
import { Quaternion, Vector3 } from '@babylonjs/core';
import { vehicleGroundPose, wheelSurfaceY } from './vehicle-grounding';
import { VEHICLE_PROFILES } from './vehicle-profiles';

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
