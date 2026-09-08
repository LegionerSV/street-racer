export const MAP_HEADER_TIMEOUT_MS = 35000;
export const MAP_IDLE_TIMEOUT_MS = 20000;
export const MAP_TOTAL_TIMEOUT_MS = 120000;
export const MAP_MAX_BYTES = 24 * 1024 * 1024;
export type DownloadMetrics = {
  receivedBytes: number;
  httpStatus?: number;
  headersMs?: number;
  readMs?: number;
  timeoutPhase?: 'headers' | 'body' | 'total';
};
export class MapDownloadError extends Error {
  constructor(
    message: string,
    readonly split: boolean,
  ) {
    super(message);
  }
}

// Отдельные часы для ответа сервера, простоя потока и всей попытки.
// Promise.race также освобождает загрузчик, если браузер не завершил reader.read().
export async function downloadMap(
  endpoint: string,
  options: RequestInit & { signal: AbortSignal },
  metrics: DownloadMetrics,
) {
  options.signal.throwIfAborted();
  const control = new AbortController(),
    begin = performance.now();
  let rejectWait!: (reason: unknown) => void;
  const stopped = new Promise<never>((_, reject) => {
    rejectWait = reject;
  });
  void stopped.catch(() => {});
  const stop = (reason: unknown) => {
    rejectWait(reason);
    control.abort(reason);
  };
  const onAbort = () => stop(options.signal.reason);
  options.signal.addEventListener('abort', onAbort, { once: true });
  const timeout = (phase: NonNullable<DownloadMetrics['timeoutPhase']>) => {
    metrics.timeoutPhase = phase;
    stop(
      new MapDownloadError(
        phase === 'headers'
          ? 'Сервер карт не ответил за 35 секунд.'
          : phase === 'body'
            ? 'Скачивание карты остановилось: нет новых данных 20 секунд.'
            : 'Скачивание участка заняло больше двух минут.',
        phase !== 'headers' && metrics.httpStatus === 200,
      ),
    );
  };
  let idle = setTimeout(() => timeout('headers'), MAP_HEADER_TIMEOUT_MS);
  const total = setTimeout(() => timeout('total'), MAP_TOTAL_TIMEOUT_MS);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await Promise.race([
      fetch(endpoint, { ...options, signal: control.signal }),
      stopped,
    ]);
    metrics.httpStatus = response.status;
    metrics.headersMs = Math.round(performance.now() - begin);
    clearTimeout(idle);
    idle = setTimeout(() => timeout('body'), MAP_IDLE_TIMEOUT_MS);
    reader = response.body?.getReader();
    const decoder = new TextDecoder(),
      pieces: string[] = [];
    if (reader)
      while (true) {
        const part = await Promise.race([reader.read(), stopped]);
        if (part.done) break;
        metrics.receivedBytes += part.value.byteLength;
        if (metrics.receivedBytes > MAP_MAX_BYTES)
          throw new MapDownloadError(
            'Участок содержит слишком много данных; загружаем меньшими частями.',
            true,
          );
        pieces.push(
          decoder.decode(
            response.ok ? part.value : part.value.subarray(0, 1024),
            { stream: true },
          ),
        );
        if (!response.ok) break;
        if (part.value.byteLength) {
          clearTimeout(idle);
          idle = setTimeout(() => timeout('body'), MAP_IDLE_TIMEOUT_MS);
        }
      }
    pieces.push(decoder.decode());
    metrics.readMs = Math.round(performance.now() - begin) - metrics.headersMs;
    return { response, body: pieces.join('') };
  } catch (error) {
    if (control.signal.aborted) throw control.signal.reason;
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(total);
    options.signal.removeEventListener('abort', onAbort);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    control.abort();
  }
}
