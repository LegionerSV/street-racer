import { afterEach, expect, it, vi } from 'vitest';
import {
  MapSource,
  mapCellQuery,
  splitMapBox,
  type MapCacheEntry,
  MAP_ENDPOINTS,
} from './map-source';
import { LoadingLog } from './loading-log';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const box = { south: 59, west: 30, north: 59.02, east: 30.04 };
const memory = () => {
  const data = new Map<string, MapCacheEntry>();
  return {
    get: async (k: string) => data.get(k),
    put: async (k: string, v: MapCacheEntry) => {
      data.set(k, v);
    },
  };
};
it('после 504 и таймаута основного сервера всё равно обращается к резервному', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('Dispatcher_Client::timeout', { status: 504 }),
    )
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce(
      Response.json({ elements: [{ type: 'node', id: 42 }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  const promise = new MapSource(new AbortController().signal).cell(
    box,
    'Карта',
  );
  const result = expect(promise).resolves.toEqual([{ type: 'node', id: 42 }]);
  // Act
  await vi.runAllTimersAsync();
  await result;
  // Assert
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    MAP_ENDPOINTS[0],
    MAP_ENDPOINTS[0],
    MAP_ENDPOINTS[1],
  ]);
});
it('предварительно делит клетку на четыре запроса и повторно открывает её из кэша', async () => {
  // Arrange
  const store = memory(),
    fetcher = vi.fn();
  for (let id = 1; id <= 4; id++)
    fetcher.mockResolvedValueOnce(
      Response.json({
        elements: [
          { type: 'node', id },
          { type: 'node', id: 99 },
        ],
      }),
    );
  vi.stubGlobal('fetch', fetcher);
  const source = new MapSource(new AbortController().signal, undefined, store);
  // Act
  const result = await source.cell(box, 'Карта', 0, true);
  const cached = await source.cell(box, 'Карта', 0, true);
  // Assert
  expect(result).toHaveLength(5);
  expect(cached).toEqual(result);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(
    fetcher.mock.calls.map((c) => (c[1].body as URLSearchParams).get('data')),
  ).toEqual(
    splitMapBox(box).map((b) => `[out:json][timeout:25];${mapCellQuery(b)}`),
  );
});
it('запрашивает только используемые автомобильные дороги, сохраняя части домов и ограничения', () => {
  // Arrange / Act
  const q = mapCellQuery(box);
  // Assert
  expect(q).toContain('motorway_link');
  expect(q).toContain('living_street');
  expect(q).not.toContain('way["highway"]');
  expect(q).toContain('way["building:part"]');
  expect(q).toContain('relation["type"="restriction"]');
  expect(q).toContain('nwr["waterway"="riverbank"]');
  expect(q).toContain('(._;>;);out body;');
});
it('превышение времени выполнения делит участок и сохраняет успешные части', async () => {
  // Arrange
  const store = memory(),
    fetcher = vi.fn().mockResolvedValueOnce(
      new Response('runtime error: Query timed out in "query" at line 1', {
        status: 504,
      }),
    );
  for (let i = 1; i <= 4; i++)
    fetcher.mockResolvedValueOnce(
      Response.json({ elements: [{ type: 'node', id: i }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  const log = new LoadingLog({ lat: 59, lon: 30 }, 'mobile'),
    source = new MapSource(new AbortController().signal, log, store);
  // Act
  const elements = await source.cell(box, 'Квартал 1');
  const calls = fetcher.mock.calls.length;
  const again = await new MapSource(
    new AbortController().signal,
    undefined,
    store,
  ).cell(box, 'Квартал 1');
  // Assert
  expect(elements.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  expect(again).toEqual(elements);
  expect(calls).toBe(5);
  expect(fetcher).toHaveBeenCalledTimes(5);
  expect(splitMapBox(box)).toHaveLength(4);
  expect(
    log
      .snapshot()
      .entries.some(
        (e) =>
          e.details.httpStatus === 504 &&
          e.details.serverMessage ===
            'runtime error: Query timed out in "query" at line 1',
      ),
  ).toBe(true);
});
it('после сбоя на второй части повтор не скачивает первую заново', async () => {
  // Arrange
  const store = memory(),
    control = new AbortController(),
    fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          remark: 'runtime error: Query timed out',
          elements: [],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ elements: [{ type: 'node', id: 1 }] }),
      )
      .mockImplementationOnce(() => {
        control.abort();
        throw new DOMException('Отмена', 'AbortError');
      });
  vi.stubGlobal('fetch', fetcher);
  // Act
  await expect(
    new MapSource(control.signal, undefined, store).cell(box, 'Квартал'),
  ).rejects.toBeDefined();
  for (let i = 2; i <= 4; i++)
    fetcher.mockResolvedValueOnce(
      Response.json({ elements: [{ type: 'node', id: i }] }),
    );
  const result = await new MapSource(
    new AbortController().signal,
    undefined,
    store,
  ).cell(box, 'Квартал');
  // Assert
  expect(result).toHaveLength(4);
  expect(fetcher).toHaveBeenCalledTimes(6);
});
it('не дробит запрос при 429, учитывает Retry-After и ограничивает попытки', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response('', { status: 429, headers: { 'Retry-After': '5' } }),
    );
  vi.stubGlobal('fetch', fetcher);
  const promise = new MapSource(new AbortController().signal).cell(
    box,
    'Квартал',
  );
  const failed = expect(promise).rejects.toThrow('Сервер карт ответил 429.');
  // Act
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await failed;
  // Assert
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[0][1].body)).toContain('timeout%3A25');
});
it('сетевой таймаут не дробит участок и пробует каждый независимый сервер один раз', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockRejectedValue(new DOMException('Время вышло', 'TimeoutError'));
  vi.stubGlobal('fetch', fetcher);
  const log = new LoadingLog({ lat: 59, lon: 30 }, 'mobile'),
    load = new MapSource(new AbortController().signal, log).cell(box, 'Карта');
  const failed = expect(load).rejects.toThrow(
    'Сервер карт не ответил за 35 секунд.',
  );
  // Act
  await vi.runAllTimersAsync();
  await failed;
  // Assert — один и тот же квадрат, по одной попытке на каждом сервере.
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(new Set(fetcher.mock.calls.map((c) => c[0])).size).toBe(3);
  expect(fetcher.mock.calls[0][0]).not.toBe(fetcher.mock.calls[1][0]);
  expect(String(fetcher.mock.calls[0][1].body)).toBe(
    String(fetcher.mock.calls[1][1].body),
  );
  expect(
    log
      .snapshot()
      .entries.filter((e) => e.details.clientTimeoutMs !== undefined)
      .every((e) => e.details.clientTimeoutMs === 35000),
  ).toBe(true);
});

it('504 из журнала занятого диспетчера повторяет исходный квадрат без дробления', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        'Dispatcher_Client::request_read_and_idx::timeout. The server is probably too busy to handle your request.',
        { status: 504 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ elements: [{ type: 'node', id: 12 }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  // Act
  const load = new MapSource(new AbortController().signal).cell(box, 'Карта');
  await vi.runAllTimersAsync();
  const result = await load;
  // Assert
  expect(result.map((e) => e.id)).toEqual([12]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe(fetcher.mock.calls[1][0]);
  expect(String(fetcher.mock.calls[0][1].body)).toBe(
    String(fetcher.mock.calls[1][1].body),
  );
});

it('обычный nginx 504 сразу переключается на другой сервер', async () => {
  // Arrange
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('<h1>504 Gateway Time-out</h1>', { status: 504 }),
    )
    .mockResolvedValueOnce(
      Response.json({ elements: [{ type: 'node', id: 27 }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  // Act
  const result = await new MapSource(new AbortController().signal).cell(
    box,
    'Карта',
  );
  // Assert
  expect(result.map((e) => e.id)).toEqual([27]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).not.toBe(fetcher.mock.calls[1][0]);
});

it('очередь ждёт окончания ответа и общей паузы 429 перед следующим участком', async () => {
  // Arrange
  vi.useFakeTimers();
  let release!: (response: Response) => void;
  const fetcher = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    )
    .mockImplementation(async () => Response.json({ elements: [] }));
  vi.stubGlobal('fetch', fetcher);
  const source = new MapSource(new AbortController().signal);
  // Act
  const first = source.request('first;', 'Первый'),
    second = source.request('second;', 'Второй');
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  release(new Response('', { status: 429, headers: { 'Retry-After': '5' } }));
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await Promise.all([first, second]);
  // Assert
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls.every((call) => call[0] === MAP_ENDPOINTS[0])).toBe(
    true,
  );
});

it('при 429 без Retry-After использует время свободного слота из статуса сервера', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('rate_limited', { status: 429 }))
    .mockResolvedValueOnce(
      new Response(
        'Rate limit: 2\nSlot available after: 2026-09-08T13:30:00Z, in 4 seconds.\nSlot available after: 2026-09-08T13:30:05Z, in 9 seconds.',
      ),
    )
    .mockResolvedValueOnce(Response.json({ elements: [] }));
  vi.stubGlobal('fetch', fetcher);
  // Act
  const load = new MapSource(new AbortController().signal).cell(box, 'Карта');
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await load;
  // Assert
  expect(fetcher.mock.calls[1][0]).toBe(
    MAP_ENDPOINTS[0].replace(/interpreter$/, 'status'),
  );
  expect(fetcher.mock.calls[2][0]).toBe(fetcher.mock.calls[0][0]);
});

it('очередь отменяется вместе с активным запросом и не начинает следующий', async () => {
  // Arrange
  const control = new AbortController();
  const fetcher = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_, reject) => {
        options.signal!.addEventListener(
          'abort',
          () => reject(options.signal!.reason),
          { once: true },
        );
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  const source = new MapSource(control.signal);
  // Act
  const loads = Promise.allSettled([
    source.request('a;', 'А'),
    source.request('b;', 'Б'),
  ]);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  control.abort();
  const results = await loads;
  // Assert
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('использует малые части, сохранённые прежней версией без плана деления', async () => {
  // Arrange
  const store = memory();
  await store.put(`osm:2:${mapCellQuery(splitMapBox(box)[0])}`, {
    savedAt: Date.now(),
    elements: [{ type: 'node', id: 1 }],
  });
  const fetcher = vi.fn();
  for (let id = 2; id <= 4; id++)
    fetcher.mockResolvedValueOnce(
      Response.json({ elements: [{ type: 'node', id }] }),
    );
  vi.stubGlobal('fetch', fetcher);
  // Act
  const elements = await new MapSource(
    new AbortController().signal,
    undefined,
    store,
  ).cell(box, 'Карта');
  // Assert
  expect(elements.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(
    (fetcher.mock.calls[0][1].body as URLSearchParams).get('data'),
  ).toContain(mapCellQuery(splitMapBox(box)[1]));
});

it('недоступный status не мешает повтору после безопасной паузы 30 секунд', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 429 }))
    .mockRejectedValueOnce(new DOMException('Время вышло', 'TimeoutError'))
    .mockResolvedValueOnce(Response.json({ elements: [] }));
  vi.stubGlobal('fetch', fetcher);
  // Act
  const load = new MapSource(new AbortController().signal).request(
    'query;',
    'Карта',
  );
  await vi.advanceTimersByTimeAsync(29999);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  await load;
  // Assert
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(fetcher.mock.calls[1][1].signal).toBeDefined();
  expect(fetcher.mock.calls[2][0]).toBe(fetcher.mock.calls[0][0]);
});

it('Retry-After в формате даты не сокращается и отмена останавливает паузу', async () => {
  // Arrange
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-08T13:30:00Z'));
  const control = new AbortController();
  const fetcher = vi.fn().mockResolvedValueOnce(
    new Response('', {
      status: 429,
      headers: { 'Retry-After': 'Tue, 08 Sep 2026 13:32:00 GMT' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const load = new MapSource(control.signal).request('query;', 'Карта');
  const failure = expect(load).rejects.toThrow();
  // Act
  await vi.advanceTimersByTimeAsync(60000);
  control.abort();
  await failure;
  // Assert
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('сбой резервного сервера не отправляет очередь снова на уже недоступный основной', async () => {
  // Arrange
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockRejectedValue(new DOMException('Время вышло', 'TimeoutError'));
  vi.stubGlobal('fetch', fetcher);
  const source = new MapSource(new AbortController().signal);
  // Act
  const settled = Promise.allSettled([
    source.request('first;', 'Первый'),
    source.request('second;', 'Второй'),
  ]);
  await vi.runAllTimersAsync();
  const results = await settled;
  // Assert
  expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('дробление ограничено одним уровнем, а частичный ответ с remark не сохраняется как карта', async () => {
  // Arrange
  vi.useFakeTimers();
  const store = memory();
  const fetcher = vi.fn().mockImplementation(async () =>
    Response.json({
      remark: 'runtime error: Query run out of memory',
      elements: [{ type: 'node', id: 123 }],
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const failure = expect(
    new MapSource(new AbortController().signal, undefined, store).cell(
      box,
      'Карта',
    ),
  ).rejects.toThrow();
  // Act
  await vi.runAllTimersAsync();
  await failure;
  // Assert
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(await store.get(`osm:2:${mapCellQuery(box)}`)).toMatchObject({
    elements: [],
    split: true,
  });
  expect(
    await store.get(`osm:2:${mapCellQuery(splitMapBox(box)[0])}`),
  ).toBeUndefined();
});
