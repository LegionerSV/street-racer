type HorizontalPoint = { x: number; z: number };

export class TrafficNeighborIndex<T extends { point: HorizontalPoint }> {
  private readonly cells = new Map<string, { order: number; value: T }[]>();
  private readonly cellSize = 128;

  constructor(items: T[]) {
    items.forEach((value, order) => {
      const key = this.key(Math.floor(value.point.x / this.cellSize), Math.floor(value.point.z / this.cellSize));
      const cell = this.cells.get(key) || [];
      cell.push({ order, value });
      this.cells.set(key, cell);
    });
  }

  private key(x: number, z: number) { return `${x},${z}`; }

  query(point: HorizontalPoint, radius: number): T[] {
    const radiusSquared = radius * radius,
      nearby: { order: number; value: T }[] = [];
    for (let x = Math.floor((point.x - radius) / this.cellSize); x <= Math.floor((point.x + radius) / this.cellSize); x++)
      for (let z = Math.floor((point.z - radius) / this.cellSize); z <= Math.floor((point.z + radius) / this.cellSize); z++)
        for (const item of this.cells.get(this.key(x, z)) || []) {
          const dx = item.value.point.x - point.x,
            dz = item.value.point.z - point.z;
          if (dx * dx + dz * dz <= radiusSquared) nearby.push(item);
        }
    return nearby.sort((a, b) => a.order - b.order).map(item => item.value);
  }
}
