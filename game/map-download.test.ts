import { afterEach, expect, it, vi } from 'vitest';
import { downloadMap, type DownloadMetrics } from './map-download';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function stream() {
  let writer!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      writer = c;
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body)),
  );
  return {
    send: (s: string) => writer.enqueue(new TextEncoder().encode(s)),
    close: () => writer.close(),
  };
}
it('дочитывает ответ дольше 35 секунд, пока сервер передаёт данные', async () => {
  // Arrange
  vi.useFakeTimers();
  const source = stream(),
    metrics: DownloadMetrics = { receivedBytes: 0 };
  const result = downloadMap(
    'https://example.test',
    { signal: new AbortController().signal },
    metrics,
  );
  // Act
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(15000);
    source.send(i ? ' ' : '{"elements":[]}');
  }
  source.close();
  // Assert
  expect((await result).body.trim()).toBe('{"elements":[]}');
  expect(metrics.receivedBytes).toBe(18);
  expect(metrics.httpStatus).toBe(200);
  expect(vi.getTimerCount()).toBe(0);
});
it('различает остановку передачи и ожидание заголовков, сохраняя число байтов', async () => {
  // Arrange
  vi.useFakeTimers();
  const source = stream(),
    metrics: DownloadMetrics = { receivedBytes: 0 };
  const result = downloadMap(
    'https://example.test',
    { signal: new AbortController().signal },
    metrics,
  );
  const failed = expect(result).rejects.toThrow(
    'Скачивание карты остановилось: нет новых данных 20 секунд.',
  );
  // Act
  source.send('abc');
  await vi.advanceTimersByTimeAsync(20000);
  await failed;
  // Assert
  expect(metrics.receivedBytes).toBe(3);
  expect(metrics.timeoutPhase).toBe('body');
  expect(vi.getTimerCount()).toBe(0);
});
it('общий предел ограничивает даже непрерывную медленную передачу', async () => {
  // Arrange
  vi.useFakeTimers();
  const source = stream(),
    metrics: DownloadMetrics = { receivedBytes: 0 };
  const result = downloadMap(
    'https://example.test',
    { signal: new AbortController().signal },
    metrics,
  );
  const failed = expect(result).rejects.toThrow(
    'Скачивание участка заняло больше двух минут.',
  );
  // Act
  for (let i = 0; i < 11; i++) {
    await vi.advanceTimersByTimeAsync(10000);
    source.send(' ');
  }
  await vi.advanceTimersByTimeAsync(10000);
  await failed;
  // Assert
  expect(metrics.timeoutPhase).toBe('total');
});
it('отмена во время чтения освобождает таймеры и не ждёт следующей порции', async () => {
  // Arrange
  vi.useFakeTimers();
  stream();
  const control = new AbortController();
  const result = downloadMap(
    'https://example.test',
    { signal: control.signal },
    { receivedBytes: 0 },
  );
  const failed = expect(result).rejects.toThrow('Отмена поездки');
  // Act
  await vi.advanceTimersByTimeAsync(1);
  control.abort(new Error('Отмена поездки'));
  await failed;
  // Assert
  expect(vi.getTimerCount()).toBe(0);
});
it('ограничивает ожидание заголовков и фиксирует нулевой объём ответа', async () => {
  // Arrange
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  const metrics: DownloadMetrics = { receivedBytes: 0 };
  const failed = expect(
    downloadMap(
      'https://example.test',
      { signal: new AbortController().signal },
      metrics,
    ),
  ).rejects.toThrow('Сервер карт не ответил за 35 секунд.');
  // Act
  await vi.advanceTimersByTimeAsync(35000);
  await failed;
  // Assert
  expect(metrics).toEqual({ receivedBytes: 0, timeoutPhase: 'headers' });
  expect(vi.getTimerCount()).toBe(0);
});
