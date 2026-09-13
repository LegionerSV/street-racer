export class MinHeap<T> {
  private items: T[] = [];
  constructor(private compare: (a: T, b: T) => number) {}
  get size() {
    return this.items.length;
  }
  push(item: T) {
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.compare(this.items[p], item) <= 0) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop(): T | undefined {
    if (!this.items.length) return;
    const top = this.items[0],
      last = this.items.pop()!;
    if (this.items.length) {
      let i = 0;
      while (i * 2 + 1 < this.items.length) {
        let c = i * 2 + 1;
        if (
          c + 1 < this.items.length &&
          this.compare(this.items[c + 1], this.items[c]) < 0
        )
          c++;
        if (this.compare(this.items[c], last) >= 0) break;
        this.items[i] = this.items[c];
        i = c;
      }
      this.items[i] = last;
    }
    return top;
  }
}
