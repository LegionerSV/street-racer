import type { Tags } from './types';

export function isTowerStructure(tags: Tags) {
  return (
    ['tower', 'water_tower'].includes(tags.man_made) && tags.building !== 'no'
  );
}

export const ROAD_TYPES = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'residential',
  'unclassified',
  'living_street',
  'service',
  'road',
] as const;
