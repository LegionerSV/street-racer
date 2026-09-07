import type { Point, RaceState, Route } from './types';
import { clamp, distance, projectOnSegment } from './geo';
export function signalPhase(time: number, axis: number, offset = 0): 'green' | 'yellow' | 'red' {
  const t = ((time + offset) % 48 + 48) % 48;
  const local = (t - axis * 24 + 48) % 48;
  return local < 18 ? 'green' : local < 21 ? 'yellow' : 'red';
}
export function desiredSpeed(limit: number, stopDistance: number, carGap: number): number {
  return Math.max(0, Math.min(limit, Math.sqrt(2 * 4 * Math.max(0, stopDistance - 2)), (carGap - 5) / 1.6));
}
export function makeRace(route: Route): RaceState { return { route, phase: 'countdown', countdown: 3, elapsed: 0, checkpoint: 1, lap: 1, position: 4 }; }
export function advanceRace(race: RaceState, position: Point, dt: number, previous?: Point) {
  if (race.phase === 'finished') return;
  if (race.phase === 'countdown') { race.countdown -= dt; if (race.countdown <= 0) race.phase = 'running'; return; }
  race.elapsed += dt;
  const target = race.route.points[race.checkpoint];
  // Отрезок между кадрами учитывает пересечение ворот на большой скорости.
  const close = distance(position, target) < 22 || (previous && projectOnSegment(target, previous, position).distance < 16 && Math.abs(position.y - target.y) < 5);
  if (!close) return;
  race.checkpoint++;
  if (race.checkpoint >= race.route.points.length) {
    if (race.lap >= race.route.laps) { race.phase = 'finished'; race.finishTime = race.elapsed; }
    else { race.lap++; race.checkpoint = 1; }
  }
}
export const raceProgress = (lap: number, distanceAlong: number, length: number) => (lap - 1) * length + distanceAlong;
export function playerProgress(race: RaceState, p: Point): number {
  const i = clamp(race.checkpoint, 1, race.route.points.length - 1);
  const projection = projectOnSegment(p, race.route.points[i - 1], race.route.points[i]);
  return raceProgress(race.lap, race.route.cumulative[i - 1] + projection.t * (race.route.cumulative[i] - race.route.cumulative[i - 1]), race.route.length);
}
export function formatTime(seconds: number) { const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60), ms = Math.floor((seconds % 1) * 100); return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`; }
