import { readFile } from 'node:fs/promises';
import {
  SOURCE_TILE_ZOOM,
  latLonToSourceTile,
  sourceTileBounds,
  type SourceTileId,
} from '../game/source-tiles.ts';

type Position = [number, number];
type PolygonCoordinates = Position[][];
type BoundaryGeometry =
  | { type: 'Polygon'; coordinates: PolygonCoordinates }
  | { type: 'MultiPolygon'; coordinates: PolygonCoordinates[] };

type BoundaryDocument = {
  type: 'FeatureCollection';
  features: { geometry: BoundaryGeometry | null }[];
};

function pointInRing([x, y]: Position, ring: Position[]) {
  let inside = false;
  for (
    let index = 0, previous = ring.length - 1;
    index < ring.length;
    previous = index++
  ) {
    const [xi, yi] = ring[index],
      [xj, yj] = ring[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function orientation(a: Position, b: Position, c: Position) {
  return Math.sign(
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  );
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position) {
  return (
    orientation(a, b, c) !== orientation(a, b, d) &&
    orientation(c, d, a) !== orientation(c, d, b)
  );
}

function ringIntersectsTile(ring: Position[], tile: SourceTileId) {
  const bounds = sourceTileBounds(tile),
    corners: Position[] = [
      [bounds.west, bounds.south],
      [bounds.west, bounds.north],
      [bounds.east, bounds.north],
      [bounds.east, bounds.south],
    ];
  if (corners.some((corner) => pointInRing(corner, ring))) return true;
  if (
    ring.some(
      ([lon, lat]) =>
        lon >= bounds.west &&
        lon <= bounds.east &&
        lat >= bounds.south &&
        lat <= bounds.north,
    )
  )
    return true;
  for (let index = 0; index < ring.length; index++) {
    const start = ring[index],
      end = ring[(index + 1) % ring.length];
    for (let side = 0; side < corners.length; side++)
      if (
        segmentsIntersect(
          start,
          end,
          corners[side],
          corners[(side + 1) % corners.length],
        )
      )
        return true;
  }
  return false;
}

function polygons(document: BoundaryDocument) {
  return document.features.flatMap(({ geometry }) => {
    if (!geometry) return [];
    return geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.coordinates;
  });
}

export function tilesIntersectingBoundary(
  document: BoundaryDocument,
  zoom = SOURCE_TILE_ZOOM,
) {
  if (document.type !== 'FeatureCollection')
    throw new Error('Граница должна быть GeoJSON FeatureCollection.');
  const areas = polygons(document);
  if (!areas.length || areas.some((area) => !area[0]?.length))
    throw new Error('GeoJSON не содержит непустой Polygon или MultiPolygon.');
  const vertices = areas.flatMap((area) => area[0]),
    west = Math.min(...vertices.map(([lon]) => lon)),
    east = Math.max(...vertices.map(([lon]) => lon)),
    south = Math.min(...vertices.map(([, lat]) => lat)),
    north = Math.max(...vertices.map(([, lat]) => lat)),
    northWest = latLonToSourceTile(north, west, zoom),
    southEast = latLonToSourceTile(south, east, zoom),
    selected: SourceTileId[] = [];
  for (let y = northWest.y; y <= southEast.y; y++)
    for (let x = northWest.x; x <= southEast.x; x++) {
      const tile = { z: zoom, x, y };
      if (areas.some((area) => ringIntersectsTile(area[0], tile)))
        selected.push(tile);
    }
  return selected;
}

export async function readBoundaryTiles(path: string, zoom = SOURCE_TILE_ZOOM) {
  const document = JSON.parse(await readFile(path, 'utf8')) as BoundaryDocument;
  return tilesIntersectingBoundary(document, zoom);
}
