import type { ElevationGrid } from './types';

// Выбросы определяются по исходному окну одновременно: исправленная точка
// не становится новым «измерением» для соседей. MAD устойчив к редким ошибкам
// обоих знаков; в отличие от среднего, выброс не увеличивает сам себе допуск.
export function rejectElevationOutliers(grid: ElevationGrid): ElevationGrid {
  if (grid.patches)
    return { ...grid, patches: grid.patches.map(rejectElevationOutliers) };
  const { width, values } = grid;
  if (width < 3) return { ...grid, values: values.slice() };
  const stepX = (grid.sizeX ?? grid.size) / (width - 1),
    stepZ = (grid.sizeZ ?? grid.size) / (width - 1);
  const rx = Math.max(1, Math.min(5, Math.round(60 / stepX))),
    rz = Math.max(1, Math.min(5, Math.round(60 / stepZ)));
  const window = new Float32Array((2 * rx + 1) * (2 * rz + 1));
  const deviations = new Float32Array(window.length),
    centers = new Float32Array(values.length),
    rejected = new Float32Array(values.length);
  const differences = new Float32Array(6);
  // После удаления фонового наклона порог относится к ошибке относительно
  // соседей, а не к допустимому уклону. 3 м — значимый остаток, не точность DEM.
  const minimum = 3;
  for (let z = 0; z < width; z++)
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - rx),
        right = Math.min(width - 1, x + rx),
        top = Math.max(0, z - rz),
        bottom = Math.min(width - 1, z + rz),
        middleX = Math.floor((left + right) / 2),
        middleZ = Math.floor((top + bottom) / 2);
      // Опорная решётка 3×3 охватывает всё окно. Шесть разностей на ось
      // дают устойчивый наклон без повторной сортировки полного окна;
      // два скачка одиночного пика не определяют медиану.
      let differenceCount = 0;
      for (let at = 0; at < 3; at++) {
        const zz = at === 0 ? top : at === 1 ? middleZ : bottom;
        if ((at === 1 && top === middleZ) || (at === 2 && bottom === middleZ))
          continue;
        if (middleX > left)
          differences[differenceCount++] =
            (values[zz * width + middleX] - values[zz * width + left]) /
            (middleX - left);
        if (right > middleX)
          differences[differenceCount++] =
            (values[zz * width + right] - values[zz * width + middleX]) /
            (right - middleX);
      }
      const slopeX = differenceCount
        ? median(differences.subarray(0, differenceCount))
        : 0;
      differenceCount = 0;
      for (let at = 0; at < 3; at++) {
        const xx = at === 0 ? left : at === 1 ? middleX : right;
        if ((at === 1 && left === middleX) || (at === 2 && right === middleX))
          continue;
        if (middleZ > top)
          differences[differenceCount++] =
            (values[middleZ * width + xx] - values[top * width + xx]) /
            (middleZ - top);
        if (bottom > middleZ)
          differences[differenceCount++] =
            (values[bottom * width + xx] - values[middleZ * width + xx]) /
            (bottom - middleZ);
      }
      const slopeZ = differenceCount
        ? median(differences.subarray(0, differenceCount))
        : 0;
      let count = 0;
      for (
        let zz = Math.max(0, z - rz);
        zz <= Math.min(width - 1, z + rz);
        zz++
      )
        for (
          let xx = Math.max(0, x - rx);
          xx <= Math.min(width - 1, x + rx);
          xx++
        )
          window[count++] =
            values[zz * width + xx] - slopeX * (xx - x) - slopeZ * (zz - z);
      const center = median(window.subarray(0, count));
      for (let i = 0; i < count; i++)
        deviations[i] = Math.abs(window[i] - center);
      const threshold = Math.max(
        minimum,
        3 * 1.4826 * median(deviations.subarray(0, count)),
      );
      const i = z * width + x,
        residual = Math.abs(values[i] - center);
      centers[i] = center;
      // Плавный переход около порога исключает скачок от малого входного шума.
      // При остатке >= 2 порогов исходная ошибочная высота больше не участвует.
      const t = Math.max(0, Math.min(1, residual / threshold - 1));
      rejected[i] = t * t * (3 - 2 * t);
    }
  const result = values.slice();
  for (let z = 0; z < width; z++)
    for (let x = 0; x < width; x++) {
      const index = z * width + x;
      if (!rejected[index]) continue;
      // Восстанавливаем наклон по оставшимся соседям, а не ставим горизонтальную
      // площадку на медианной высоте. Вес сомнительных соседей убывает плавно.
      // Локальные координаты сохраняют точность.
      let n = 0,
        sx = 0,
        sz = 0,
        sy = 0,
        sxx = 0,
        szz = 0,
        sxz = 0,
        sxy = 0,
        szy = 0;
      for (
        let zz = Math.max(0, z - rz);
        zz <= Math.min(width - 1, z + rz);
        zz++
      )
        for (
          let xx = Math.max(0, x - rx);
          xx <= Math.min(width - 1, x + rx);
          xx++
        ) {
          const at = zz * width + xx;
          const confidence = 1 - rejected[at];
          if (at === index || !confidence) continue;
          const dx = (xx - x) / rx,
            dz = (zz - z) / rz,
            h = values[at] - centers[index];
          n += confidence;
          sx += confidence * dx;
          sz += confidence * dz;
          sy += confidence * h;
          sxx += confidence * dx * dx;
          szz += confidence * dz * dz;
          sxz += confidence * dx * dz;
          sxy += confidence * dx * h;
          szy += confidence * dz * h;
        }
      // Без независимых опор исходник сохраняется: нельзя придумать уровень
      // по группе отсчётов, которую целиком признали недостоверной.
      if (n < 3) continue;
      const a = sxx - (sx * sx) / n,
        b = sxz - (sx * sz) / n,
        c = szz - (sz * sz) / n;
      const d = sxy - (sx * sy) / n,
        e = szy - (sz * sy) / n,
        determinant = a * c - b * b;
      if (determinant < 1e-8) continue;
      const gradeX = (d * c - e * b) / determinant,
        gradeZ = (e * a - d * b) / determinant;
      const estimate = centers[index] + (sy - gradeX * sx - gradeZ * sz) / n;
      result[index] += (estimate - values[index]) * rejected[index];
    }
  return { ...grid, values: result };
}

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
