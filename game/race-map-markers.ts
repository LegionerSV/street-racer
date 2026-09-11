import { pathLengths, pointAt } from './geo';
import type { Point, Route, World } from './types';
import { edgeById } from './road-graph';
import type { RacerTraits } from './types';
import { DEFAULT_RACER_TRAITS } from './racing-ai';

export const RACER_COLOURS = ['#d7e0df', '#e25542', '#794fd0'];
export type OpponentMarker = {
  id: number;
  point: Point;
  heading: number;
  colour: string;
  finished: boolean;
  progress?: number;
  traits?: RacerTraits;
};
export function opponentMarkers(
  agents: {
    id: number;
    point: Point;
    heading: number;
    visual?: { root: { position: Point } };
    race?: { finished: boolean; progress?: number; traits?: RacerTraits };
  }[],
): OpponentMarker[] {
  return agents
    .filter((a) => a.race)
    .map((a) => ({
      id: a.id,
      point: { ...(a.visual?.root.position ?? a.point) },
      heading: a.heading,
      colour: RACER_COLOURS[a.id % RACER_COLOURS.length],
      finished: a.race!.finished,
      progress: a.race!.progress || 0,
      traits: a.race!.traits || DEFAULT_RACER_TRAITS,
    }));
}
// Позиция одна для трёхмерного маркера и миникарты; индекс списка на неё не влияет.
export function raceMarkerPosition(world: World, route: Route): Point {
  const edge = edgeById(world, route.edges[0]),
    sprint = route.kind === 'sprint';
  if (!edge) throw new Error(`Маршрут ${route.id} ссылается на отсутствующую дорогу.`);
  return pointAt(
    edge.points,
    pathLengths(edge.points),
    Math.min(sprint ? 90 : 55, edge.length * (sprint ? 0.75 : 0.45)),
  ).point;
}
export function minimapOpponent(
  marker: OpponentMarker,
  player: Point,
  width = 300,
  height = 240,
  scale = 0.23,
) {
  const dx = (marker.point.x - player.x) * scale,
    dy = -(marker.point.z - player.z) * scale;
  const factor = Math.max(
    1,
    Math.abs(dx) / (width / 2 - 12),
    Math.abs(dy) / (height / 2 - 12),
  );
  return {
    x: width / 2 + dx / factor,
    y: height / 2 + dy / factor,
    offscreen: factor > 1,
    heading: factor > 1 ? Math.atan2(dx, -dy) : marker.heading,
  };
}
