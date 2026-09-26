import { Quaternion, Vector3 } from '@babylonjs/core';
import type { Point } from './types';
import type { VehicleProfile } from './vehicle-profiles';
import type { CarVisual } from './visuals';

export type VehicleSurface = (x: number, z: number) => number | undefined;
export function wheelSurfaceY(
  rootY: number,
  localWorldY: number,
  radius: number,
  pitch: number,
  roll: number,
) {
  return rootY + localWorldY - radius * Math.cos(pitch) * Math.cos(roll);
}

export function vehicleGroundPose(
  profile: VehicleProfile,
  point: Point,
  heading: number,
  surface: VehicleSurface,
) {
  const wheels = [profile.wheelbase / 2, -profile.wheelbase / 2].flatMap((z) =>
    [-profile.track / 2, profile.track / 2].map(
      (x) => new Vector3(x, -profile.rideHeight + profile.wheelRadius, z),
    ),
  );
  const height = (x: number, z: number) => {
    const value = surface(x, z);
    return value !== undefined && Number.isFinite(value) ? value : point.y;
  };
  const yaw = Quaternion.RotationYawPitchRoll(heading, 0, 0);
  const heights = wheels.map((w) => {
    const p = w.applyRotationQuaternion(yaw);
    return height(point.x + p.x, point.z + p.z);
  });
  const pitch =
    -Math.atan2(
      (heights[0] + heights[1] - heights[2] - heights[3]) / 2,
      profile.wheelbase,
    ) || 0;
  const roll = Math.atan2(
    (heights[1] + heights[3] - heights[0] - heights[2]) / 2,
    profile.track,
  );
  const rotation = Quaternion.RotationYawPitchRoll(heading, pitch, roll);
  const support = wheels.map((w) => {
    const p = w.applyRotationQuaternion(rotation);
    return (
      height(point.x + p.x, point.z + p.z) -
      p.y +
      profile.wheelRadius * Math.cos(pitch) * Math.cos(roll)
    );
  });
  // На переломе профиля шины не должны проваливаться сквозь асфальт.
  return { y: Math.max(...support), pitch, roll };
}

export function settleVehicleWheels(car: CarVisual, surface: VehicleSurface) {
  const p = car.profile,
    rotation =
      car.root.rotationQuaternion ??
      Quaternion.FromEulerVector(car.root.rotation);
  const up = Vector3.Up().applyRotationQuaternion(rotation);
  if (up.y < 0.5) return;
  for (const wheel of car.wheels) {
    const nominal = -p.rideHeight + p.wheelRadius;
    const offset = new Vector3(
      wheel.position.x,
      nominal,
      wheel.position.z,
    ).applyRotationQuaternion(rotation);
    const ground = surface(
      car.root.position.x + offset.x,
      car.root.position.z + offset.z,
    );
    const extension =
      ground !== undefined && Number.isFinite(ground)
        ? (ground + p.wheelRadius * up.y - car.root.position.y - offset.y) /
          up.y
        : 0;
    wheel.position.y = nominal + Math.max(-0.22, Math.min(0.16, extension));
  }
}
