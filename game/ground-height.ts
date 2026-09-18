export function blendGroundHeight(
  base: number,
  roads: { height: number; influence: number }[],
) {
  let sum = 0,
    weight = 0;
  for (const road of roads) {
    const w = road.influence * road.influence;
    sum += (base + (road.height - base) * road.influence) * w;
    weight += w;
  }
  return weight ? sum / weight : base;
}
