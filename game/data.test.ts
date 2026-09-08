import 'fake-indexeddb/auto';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  cacheGet,
  cachePut,
  validateCenter,
  loadRegion,
  regionKey,
  abortableDelay,
} from './data';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Загрузка и сохранение района', () => {
  it('общий предел ожидания отменяет все сетевые запросы с понятным сообщением', async () => {
    // Arrange
    const deadline = new AbortController(),
      nativeTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) =>
      ms === 120000 ? deadline.signal : nativeTimeout(ms),
    );
    let running = 0,
      started = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, options: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            started++;
            running++;
            options.signal!.addEventListener(
              'abort',
              () => {
                running--;
                reject(options.signal!.reason);
              },
              { once: true },
            );
          }),
      ),
    );
    const load = loadRegion(
      { lat: 55.12345, lon: 37.12345 },
      new AbortController().signal,
      () => {},
    );
    const failure = expect(load).rejects.toThrow(
      'Загрузка заняла больше двух минут. Готовые части карты сохранены; повторите попытку.',
    );
    // Act
    await vi.waitFor(() => expect(started).toBeGreaterThanOrEqual(3));
    deadline.abort(new DOMException('Время вышло', 'TimeoutError'));
    await failure;
    // Assert
    expect(running).toBe(0);
  });
  it('загружает карту через общую очередь, рельеф параллельно, а прогресс не идёт назад', async () => {
    // Arrange
    const controller = new AbortController(),
      held: (() => void)[] = [];
    let hold = true,
      active = 0,
      maxActive = 0,
      heightRequests = 0;
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = 128;
      pixels[i + 3] = 255;
    }
    vi.stubGlobal('createImageBitmap', async () => ({ close: () => {} }));
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data: pixels }),
        }),
      }),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        if (!url.includes('overpass')) {
          heightRequests++;
          return new Response(new Blob(['image']));
        }
        active++;
        maxActive = Math.max(maxActive, active);
        try {
          if (hold)
            await new Promise<void>((resolve, reject) => {
              held.push(resolve);
              options.signal!.addEventListener(
                'abort',
                () => reject(options.signal!.reason),
                { once: true },
              );
            });
          const q = (options.body as URLSearchParams).toString();
          return Response.json({
            elements: q.includes('is_in')
              ? [{ type: 'area', id: 1, tags: { 'ISO3166-1': 'RU' } }]
              : [{ type: 'node', id: 42, lat: 59.93331, lon: 30.33531 }],
          });
        } finally {
          active--;
        }
      }),
    );
    const progress: number[] = [],
      load = loadRegion(
        { lat: 59.93331, lon: 30.33531 },
        controller.signal,
        (_, n) => progress.push(n),
      );
    void load.catch(() => {});
    try {
      // Act
      await vi.waitFor(
        () => {
          expect(held).toHaveLength(1);
          expect(heightRequests).toBeGreaterThan(0);
        },
        { timeout: 500 },
      );
      hold = false;
      held.forEach((resolve) => resolve());
      const result = await load;
      // Assert
      expect(maxActive).toBe(1);
      expect(result.elements.filter((e) => e.id === 42)).toHaveLength(1);
      expect(result.drivingSide).toBe('right');
      expect(progress.every((n, i) => i === 0 || n >= progress[i - 1])).toBe(
        true,
      );
      expect(progress.at(-1)).toBe(83);
    } finally {
      controller.abort();
      await load.catch(() => {});
    }
  });
  it('сохраняет типизированный массив высот без потери данных', async () => {
    // Arrange
    const input = { values: new Float32Array([10.25, -4.5]) };
    // Act
    await cachePut('test:heights', input);
    const result = await cacheGet<typeof input>('test:heights');
    // Assert
    expect(result?.values).toEqual(input.values);
  });
  it('запрещает недопустимые координаты с точным объяснением', () => {
    // Arrange / Act / Assert
    expect(() => validateCenter({ lat: NaN, lon: 37 })).toThrow(
      'Выберите точку между 83.9° ю. ш. и 83.9° с. ш., вдали от линии перемены дат.',
    );
  });
  it('повторно открывает сохранённый район без сетевых запросов', async () => {
    // Arrange
    const center = { lat: 55.751, lon: 37.618 },
      saved = {
        center,
        elements: [],
        elevation: { width: 2, size: 5600, values: new Float32Array(4) },
        drivingSide: 'right' as const,
        fetchedAt: 'test',
      };
    await cachePut(regionKey(center), saved);
    const request = vi.spyOn(globalThis, 'fetch');
    // Act
    const result = await loadRegion(
      center,
      new AbortController().signal,
      () => {},
    );
    // Assert
    expect(result).toEqual(saved);
    expect(request).not.toHaveBeenCalled();
    request.mockRestore();
  });
  it('останавливает ожидание и загрузку после отмены', async () => {
    // Arrange
    const control = new AbortController();
    control.abort();
    // Act / Assert
    await expect(abortableDelay(5000, control.signal)).rejects.toBeDefined();
    await expect(
      loadRegion({ lat: 0, lon: 0 }, control.signal, () => {}),
    ).rejects.toBeDefined();
  });
});
