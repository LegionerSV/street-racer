import { distance2 } from './geo';
import type { NavigationHint, Point, RaceState } from './types';

const turnAt = (points: Point[], i: number) => {
  const incoming = { x: points[i].x - points[i - 1].x, z: points[i].z - points[i - 1].z };
  const outgoing = { x: points[i + 1].x - points[i].x, z: points[i + 1].z - points[i].z };
  return {
    angle: Math.atan2(incoming.x * outgoing.z - incoming.z * outgoing.x, incoming.x * outgoing.x + incoming.z * outgoing.z),
    outgoing,
  };
};

export function nextRaceTurn(race: RaceState, position: Point, range = 120): NavigationHint | null {
  if (race.phase !== 'running') return null;
  const points = race.route.points;
  const previousTurn = race.checkpoint - 1;
  if (previousTurn >= 1 && previousTurn < points.length - 1) {
    const { angle, outgoing } = turnAt(points, previousTurn);
    const length = Math.hypot(outgoing.x, outgoing.z);
    const passed = length ? ((position.x - points[previousTurn].x) * outgoing.x + (position.z - points[previousTurn].z) * outgoing.z) / length : 0;
    const distance = distance2(position, points[previousTurn]);
    if (Math.abs(angle) >= Math.PI / 7 && passed < 8 && distance <= range) return { direction: angle > 0 ? 'left' : 'right', distance };
  }
  let distance = distance2(position, points[race.checkpoint]);
  for (let i = race.checkpoint; i < points.length - 1; i++) {
    const { angle } = turnAt(points, i);
    if (Math.abs(angle) >= Math.PI / 7) return distance <= range ? { direction: angle > 0 ? 'left' : 'right', distance } : null;
    distance += distance2(points[i], points[i + 1]);
    if (distance > range) return null;
  }
  return null;
}
