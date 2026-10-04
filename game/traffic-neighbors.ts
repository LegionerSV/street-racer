type HorizontalPoint = { x: number; z: number };

export class TrafficNeighborIndex<T extends { point: HorizontalPoint }> {
  private readonly cells = new Map<string, number[]>();
  private readonly cellSize = 128;
  private readonly pool: number[][] = [];
  private matches = new Uint8Array(0);
  private items: T[] = [];

  constructor(items: T[] = []) {
    this.reset(items);
  }

  reset(items: T[]) {
    for (const cell of this.cells.values()) {
      cell.length = 0;
      this.pool.push(cell);
    }
    this.cells.clear();
    this.items.length = items.length;
    if (this.matches.length < items.length) this.matches = new Uint8Array(items.length);
    items.forEach((value, order) => {
      this.items[order] = value;
      const key = this.key(Math.floor(value.point.x / this.cellSize), Math.floor(value.point.z / this.cellSize));
      const cell = this.cells.get(key) || this.pool.pop() || [];
      cell.push(order);
      this.cells.set(key, cell);
    });
  }

  private key(x: number, z: number) { return `${x},${z}`; }

  query(point: HorizontalPoint, radius: number, result: T[] = []): T[] {
    const radiusSquared = radius * radius;
    this.matches.fill(0);
    result.length = 0;
    for (let x = Math.floor((point.x - radius) / this.cellSize); x <= Math.floor((point.x + radius) / this.cellSize); x++)
      for (let z = Math.floor((point.z - radius) / this.cellSize); z <= Math.floor((point.z + radius) / this.cellSize); z++)
        for (const order of this.cells.get(this.key(x, z)) || []) {
          const item = this.items[order];
          const dx = item.point.x - point.x,
            dz = item.point.z - point.z;
          if (dx * dx + dz * dz <= radiusSquared) this.matches[order] = 1;
        }
    for (let order = 0; order < this.items.length; order++)
      if (this.matches[order]) result.push(this.items[order]);
    return result;
  }
}
