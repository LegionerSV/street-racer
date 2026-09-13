// Скользящий экстремум: каждый элемент входит и выходит из очереди один раз.
// Продолжение краевого уклона совпадает с исходным фильтром DEM.
export function openingPass(
  values: Float32Array,
  width: number,
  radius: number,
  axis: number,
  minimum: boolean,
) {
  const next = new Float32Array(values.length);
  const indices = new Int32Array(width + 2 * radius),
    heights = new Float64Array(indices.length);
  for (let line = 0; line < width; line++) {
    let head = 0,
      tail = 0;
    const base = axis ? line : line * width,
      stride = axis ? width : 1;
    for (let at = -radius; at < width + radius; at++) {
      const bounded = Math.max(0, Math.min(width - 1, at)),
        index = base + bounded * stride;
      let h = values[index];
      if (at !== bounded) {
        const inward = bounded === 0 ? 1 : -1;
        h += ((at - bounded) * (values[index + inward * stride] - h)) / inward;
      }
      while (head < tail && indices[head] < at - radius * 2) head++;
      while (
        head < tail &&
        (minimum ? heights[tail - 1] >= h : heights[tail - 1] <= h)
      )
        tail--;
      indices[tail] = at;
      heights[tail++] = h;
      const out = at - radius;
      if (out >= 0) next[base + out * stride] = heights[head];
    }
  }
  return next;
}

// Выбор медианы без сортировки всего окна и выделения массива для каждой ячейки.
export function median(values: Float32Array) {
  let left = 0,
    right = values.length - 1;
  const middle = values.length >> 1;
  while (left < right) {
    const pivot = values[(left + right) >> 1];
    let i = left,
      j = right;
    while (i <= j) {
      while (values[i] < pivot) i++;
      while (values[j] > pivot) j--;
      if (i <= j) {
        const temp = values[i];
        values[i++] = values[j];
        values[j--] = temp;
      }
    }
    if (middle <= j) right = j;
    else if (middle >= i) left = i;
    else break;
  }
  return values[middle];
}
