import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { cacheGet, cachePut, validateCenter, loadRegion, regionKey, abortableDelay } from './data';

describe('Загрузка и сохранение района', () => {
  it('сохраняет типизированный массив высот без потери данных', async () => {
    // Arrange
    const input = { values: new Float32Array([10.25, -4.5]) };
    // Act
    await cachePut('test:heights', input); const result = await cacheGet<typeof input>('test:heights');
    // Assert
    expect(result?.values).toEqual(input.values);
  });
  it('запрещает недопустимые координаты с точным объяснением', () => {
    // Arrange / Act / Assert
    expect(() => validateCenter({ lat: NaN, lon: 37 })).toThrow('Выберите точку между 83.9° ю. ш. и 83.9° с. ш., вдали от линии перемены дат.');
  });
  it('повторно открывает сохранённый район без сетевых запросов', async () => {
    // Arrange
    const center = { lat: 55.751, lon: 37.618 }, saved = { center, elements: [], elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right' as const, fetchedAt: 'test' };
    await cachePut(regionKey(center), saved); const request = vi.spyOn(globalThis, 'fetch');
    // Act
    const result = await loadRegion(center, new AbortController().signal, () => {});
    // Assert
    expect(result).toEqual(saved); expect(request).not.toHaveBeenCalled(); request.mockRestore();
  });
  it('останавливает ожидание и загрузку после отмены', async () => {
    // Arrange
    const control = new AbortController(); control.abort();
    // Act / Assert
    await expect(abortableDelay(5000, control.signal)).rejects.toBeDefined();
    await expect(loadRegion({ lat: 0, lon: 0 }, control.signal, () => {})).rejects.toBeDefined();
  });
});
