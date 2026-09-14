// При укрупнении DSM одиночный отсчёт теряет узкие низкие участки между
// зданиями. Нижняя огибающая ячейки сохраняет такие опоры; отрицательные
// выбросы затем проверяются вместе с соседними ячейками фильтром DEM.
export function sampleGroundFootprint(
  px: number,
  py: number,
  cellMeters: number,
  latitude: number,
  zoom: number,
  sample: (x: number, y: number) => number | null | undefined,
): number | undefined {
  const metersPerPixel =
    (40075016.68557849 * Math.cos((latitude * Math.PI) / 180)) /
    (2 ** zoom * 256);
  const half = cellMeters / metersPerPixel / 2;
  let minimum = Infinity;
  for (let y = Math.ceil(py - half); y <= Math.floor(py + half); y++)
    for (let x = Math.ceil(px - half); x <= Math.floor(px + half); x++) {
      const h = sample(x, y);
      if (h !== null && h !== undefined && Number.isFinite(h))
        minimum = Math.min(minimum, h);
    }
  return minimum < Infinity ? minimum : undefined;
}
