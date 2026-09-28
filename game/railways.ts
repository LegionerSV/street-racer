import {
  pathLengths,
  pointAt,
  projectOnSegment,
  sampleElevation,
  toLocal,
} from './geo';
import type {
  ElevationGrid,
  ParkedWagon,
  Point,
  RailLine,
  RegionData,
} from './types';

const ACTIVE_RAILWAYS = new Set(['rail', 'narrow_gauge']);

export function buildRailways(
  region: RegionData,
  elevation: ElevationGrid,
): RailLine[] {
  const nodes = new Map(
    region.elements
      .filter((element) => element.type === 'node')
      .map((node) => [node.id, node]),
  );
  const lines: RailLine[] = [];
  for (const way of region.elements) {
    const tags = way.tags ?? {};
    if (
      way.type !== 'way' ||
      !way.nodes ||
      !ACTIVE_RAILWAYS.has(tags.railway) ||
      (tags.tunnel && tags.tunnel !== 'no') ||
      tags.location === 'underground' ||
      tags.usage === 'disused' ||
      tags.access === 'no'
    )
      continue;
    const points = way.nodes.map((id) => {
      const node = nodes.get(id);
      if (node?.lat === undefined || node.lon === undefined) return null;
      const point = toLocal(node.lat, node.lon, region.center);
      point.y = sampleElevation(elevation, point.x, point.z);
      return point;
    });
    if (points.length < 2 || points.some((point) => !point)) continue;
    const track = points as Point[];
    const bridge = !!tags.bridge && tags.bridge !== 'no';
    lines.push({
      id: way.id,
      nodes: [...way.nodes],
      points: track,
      bridge,
      service: tags.service || '',
    });
  }
  for (const line of lines)
    if (line.bridge)
      for (const point of line.points) point.y += 5;
  const raised = new Map<number, number>();
  for (const line of lines)
    if (line.bridge)
      for (let i = 0; i < line.nodes.length; i++)
        raised.set(line.nodes[i], line.points[i].y);
  for (const line of lines)
    if (!line.bridge) {
      const lengths = pathLengths(line.points),
        total = lengths.at(-1) || 0;
      const start = raised.get(line.nodes[0]),
        end = raised.get(line.nodes.at(-1)!);
      for (let i = 0; i < line.points.length; i++) {
        const startWeight =
          start === undefined ? 0 : Math.max(0, 1 - lengths[i] / 100);
        const endWeight =
          end === undefined ? 0 : Math.max(0, 1 - (total - lengths[i]) / 100);
        if (startWeight)
          line.points[i].y += (start! - line.points[i].y) * startWeight;
        if (endWeight)
          line.points[i].y += (end! - line.points[i].y) * endWeight;
      }
    }
  return lines;
}

export function parkedWagons(
  lines: RailLine[],
  region: RegionData,
): ParkedWagon[] {
  const nodes = new Map(
    region.elements
      .filter((element) => element.type === 'node')
      .map((node) => [node.id, node]),
  );
  const ways = new Map(
    region.elements
      .filter((element) => element.type === 'way')
      .map((way) => [way.id, way]),
  );
  const stations = region.elements.flatMap((element) => {
    const tags = element.tags ?? {};
    if (
      tags.railway !== 'station' ||
      ['subway', 'light_rail', 'tram', 'monorail'].includes(tags.station || '') ||
      tags.subway === 'yes'
    ) return [];
    if (element.lat !== undefined && element.lon !== undefined)
      return [toLocal(element.lat, element.lon, region.center)];
    const stationNodes = element.nodes ?? (element.members ?? [])
      .filter((member) => member.type === 'way')
      .flatMap((member) => ways.get(member.ref)?.nodes ?? []);
    const points = stationNodes.flatMap((id) => {
      const node = nodes.get(id);
      return node?.lat !== undefined && node.lon !== undefined
        ? [toLocal(node.lat, node.lon, region.center)]
        : [];
    });
    return points.length
      ? [
          {
            x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
            y: 0,
            z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
          },
        ]
      : [];
  });
  const result: ParkedWagon[] = [],
    used = new Set<number>();
  const stationProjection = (line: RailLine, station: Point) => {
    const lengths = pathLengths(line.points);
    let distance = Infinity,
      along = 0;
    for (let i = 1; i < line.points.length; i++) {
      const projection = projectOnSegment(
        station,
        line.points[i - 1],
        line.points[i],
      );
      if (projection.distance < distance) {
        distance = projection.distance;
        along = lengths[i - 1] + projection.t * (lengths[i] - lengths[i - 1]);
      }
    }
    return { line, lengths, distance, along, total: lengths.at(-1)! };
  };
  for (const station of stations) {
    const siding = lines
      .filter((line) =>
        ['siding', 'yard', 'spur'].includes(line.service) && !used.has(line.id),
      )
      .map((line) => stationProjection(line, station))
      .filter((candidate) => candidate.total >= 85)
      .sort((a, b) => a.distance - b.distance)[0];
    if (!siding || siding.distance > 250) continue;
    used.add(siding.line.id);
    const { line, lengths, total, along } = siding;
    const count = Math.min(4, Math.max(2, Math.floor((total - 35) / 20)));
    const first = Math.max(
      15,
      Math.min(total - 15 - (count - 1) * 20, along - ((count - 1) * 20) / 2),
    );
    for (let i = 0; i < count; i++) {
      const at = first + i * 20;
      const point = pointAt(line.points, lengths, at).point;
      const ahead = pointAt(
        line.points,
        lengths,
        Math.min(total, at + 2),
      ).point;
      result.push({
        id: `${line.id}:${i}`,
        point,
        heading: Math.atan2(ahead.x - point.x, ahead.z - point.z),
      });
    }
  }
  return result;
}

export function trainOpportunity(
  lines: RailLine[],
  activeSeconds: number,
  visible: (point: Point) => boolean,
  covered: (point: Point) => boolean,
): RailLine | null {
  if (activeSeconds < 480) return null;
  for (const line of lines) {
    if (line.service || pathLengths(line.points).at(-1)! < 300) continue;
    const lengths = pathLengths(line.points),
      total = lengths.at(-1)!;
    let inView = false;
    for (let d = 0; d <= total; d += 40) {
      const point = pointAt(line.points, lengths, d).point;
      inView ||= visible(point);
    }
    if (!inView) continue;
    let complete = true;
    for (let d = 0; d <= total; d += 40)
      complete &&= covered(pointAt(line.points, lengths, d).point);
    if (complete && covered(line.points.at(-1)!)) return line;
  }
  return null;
}

export function advanceTrainProgress(
  progress: number,
  dt: number,
  paused: boolean,
): number {
  return progress + (paused ? 0 : Math.max(0, dt) * 14);
}

export function trainCooldown(random: number): number {
  return 480 + Math.max(0, Math.min(1, random)) * 420;
}
