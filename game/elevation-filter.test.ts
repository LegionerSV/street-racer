import { expect, it } from 'vitest';
import { smoothElevation, clamp } from './geo';

// Независимый медленный эталон: защищает высоты при замене алгоритма фильтра.
function reference(width: number, size: number, input: Float32Array) {
  const radius = Math.max(
    1,
    Math.min(5, Math.round(65 / (size / (width - 1)))),
  );
  const opening = Math.max(1, Math.round(250 / (size / (width - 1))));
  let values = input.slice();
  for (const minimum of [true, false])
    for (const axis of [0, 1]) {
      const next = new Float32Array(values.length);
      for (let z = 0; z < width; z++)
        for (let x = 0; x < width; x++) {
          const window: number[] = [];
          for (let d = -opening; d <= opening; d++) {
            const at = (axis ? z : x) + d,
              bounded = clamp(at, 0, width - 1),
              index = axis ? bounded * width + x : z * width + bounded;
            let h = values[index];
            if (at !== bounded) {
              const inward = bounded === 0 ? 1 : -1;
              h +=
                ((at - bounded) *
                  (values[index + inward * (axis ? width : 1)] - h)) /
                inward;
            }
            window.push(h);
          }
          next[z * width + x] = minimum
            ? Math.min(...window)
            : Math.max(...window);
        }
      values = next;
    }
  const opened = Float32Array.from(values, (v, i) =>
    input[i] - v > 5 ? v : input[i],
  );
  for (let z = 0; z < width; z++)
    for (let x = 0; x < width; x++) {
      const window: number[] = [];
      for (let dz = -radius; dz <= radius; dz++)
        for (let dx = -radius; dx <= radius; dx++)
          window.push(
            opened[
              clamp(z + dz, 0, width - 1) * width + clamp(x + dx, 0, width - 1)
            ],
          );
      values[z * width + x] = window.sort((a, b) => a - b)[window.length >> 1];
    }
  for (let pass = 0; pass < 2; pass++)
    for (const axis of [0, 1]) {
      const next = new Float32Array(values.length);
      for (let z = 0; z < width; z++)
        for (let x = 0; x < width; x++) {
          let sum = 0,
            weight = 0;
          for (let d = -radius; d <= radius; d++) {
            const w = radius + 1 - Math.abs(d);
            sum +=
              values[
                clamp(z + (axis ? d : 0), 0, width - 1) * width +
                  clamp(x + (axis ? 0 : d), 0, width - 1)
              ] * w;
            weight += w;
          }
          next[z * width + x] = sum / weight;
        }
      values = next;
    }
  return values;
}

it.each([60, 700, 2000])(
  'быстрый фильтр совпадает с эталоном, включая края и окно шире сетки: %s',
  (size) => {
    // Arrange
    const width = 13,
      values = Float32Array.from(
        { length: width * width },
        (_, i) => 20 + Math.sin(i * 19) * 18 + i / 11,
      ),
      original = values.slice();
    // Act
    const filtered = smoothElevation({ width, size, values });
    // Assert
    expect(filtered.values).toEqual(reference(width, size, values));
    expect(values).toEqual(original);
  },
);
