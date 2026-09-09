import type { OSMElement } from './types';
import type { LoadingLog } from './loading-log';
import { roadTypes } from './lanes';
import {
  downloadMap,
  MapDownloadError,
  MAP_HEADER_TIMEOUT_MS,
  MAP_IDLE_TIMEOUT_MS,
  MAP_TOTAL_TIMEOUT_MS,
  type DownloadMetrics,
} from './map-download';
export type MapBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};
export type MapCacheEntry = {
  elements: OSMElement[];
  savedAt: number;
  split?: true;
};
type Store = {
  get: (key: string) => Promise<MapCacheEntry | undefined>;
  put: (key: string, value: MapCacheEntry) => Promise<void>;
};
export const MAP_ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
export const MAP_REQUEST_TIMEOUT_MS = MAP_HEADER_TIMEOUT_MS;
export async function abortableDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
export function splitMapBox(b: MapBox): MapBox[] {
  const lat = (b.south + b.north) / 2,
    lon = (b.west + b.east) / 2;
  return Array.from({ length: 4 }, (_, q) => ({
    south: q < 2 ? b.south : lat,
    north: q < 2 ? lat : b.north,
    west: q % 2 === 0 ? b.west : lon,
    east: q % 2 === 0 ? lon : b.east,
  }));
}
export function mapCellQuery(b: MapBox) {
  const bb = [b.south, b.west, b.north, b.east]
    .map((n) => n.toFixed(7))
    .join(',');
  return `(way["highway"~"^(${[...roadTypes].join('|')})$"](${bb});node["highway"="traffic_signals"](${bb});relation["type"="restriction"](${bb});way["building"](${bb});way["building:part"](${bb});relation["building"](${bb});nwr["natural"~"^(water|wood|tree)$"](${bb});nwr["waterway"="riverbank"](${bb});nwr["landuse"~"^(forest|grass|meadow|reservoir)$"](${bb});nwr["leisure"="park"](${bb}););(._;>;);out body;`;
}
class MapRequestError extends Error {
  constructor(
    message: string,
    readonly split = false,
    readonly status?: number,
    readonly retryAfterMs = 2500,
  ) {
    super(message);
  }
}
// Перегрузка диспетчера не означает, что географический запрос слишком велик.
function executionLimit(message = '') {
  return (
    !/Dispatcher_Client/i.test(message) &&
    /Query timed out|Query run out of memory|out of memory|exceeded.*memory/i.test(
      message,
    )
  );
}
function fresh(entry?: MapCacheEntry): entry is MapCacheEntry {
  return !!entry && Date.now() - entry.savedAt < 7 * 24 * 60 * 60 * 1000;
}
export class MapSource {
  private preferred = 0;
  private queue: Promise<void> = Promise.resolve();
  private unavailable = new Set<number>();
  private readyAt = MAP_ENDPOINTS.map(() => 0);
  constructor(
    private signal: AbortSignal,
    private log?: LoadingLog,
    private store?: Store,
  ) {
    this.log?.start('План загрузки карты', {
      policyVersion: 6,
      mapConcurrency: 1,
    })();
  }
  private key(query: string) {
    return `osm:2:${query}`;
  }
  private async cached(query: string, stage: string) {
    const end = this.log?.start(`${stage} / кэш`),
      cached = await this.store?.get(this.key(query));
    this.signal.throwIfAborted();
    const valid = fresh(cached);
    end?.('success', {
      cacheHit: !!valid,
      elements: valid ? cached.elements.length : 0,
      split: valid ? !!cached.split : false,
    });
    return valid ? cached : undefined;
  }
  private async save(query: string, elements: OSMElement[]) {
    await this.store?.put(this.key(query), { elements, savedAt: Date.now() });
  }
  async request(
    query: string,
    stage: string,
    splitOnTimeout = false,
  ): Promise<OSMElement[]> {
    this.signal.throwIfAborted();
    const cached = await this.cached(query, stage);
    if (cached && !cached.split) return cached.elements;
    if (cached?.split && splitOnTimeout)
      throw new MapRequestError(
        'Продолжаем загрузку сохранённых частей.',
        true,
      );
    // Одна очередь включает чтение тела и повторы: соседние задания не занимают
    // квоту сервера, пока первый запрос ещё выполняется или ждёт Retry-After.
    const end = this.log?.start(`${stage} / очередь`);
    const result = this.queue.then(async () => {
      this.signal.throwIfAborted();
      end?.();
      return this.fetchQuery(query, stage, splitOnTimeout);
    });
    this.queue = result.then(
      () => {},
      () => {},
    );
    try {
      return await result;
    } catch (error) {
      end?.(this.signal.aborted ? 'cancelled' : 'error');
      throw error;
    }
  }
  private async slotDelay(endpoint: string, stage: string) {
    const url = endpoint.replace(/interpreter$/, 'status'),
      end = this.log?.start(`${stage} / доступность сервера`, {
        endpoint: url,
        clientTimeoutMs: 3000,
      });
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(3000)]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const status = await response.text();
      // Сохраняем только срок ожидания, без идентификатора клиента из /status.
      const slots = [
        ...status.matchAll(/Slot available after:[^\n]*?in (\d+) seconds/g),
      ].map((match) => Number(match[1]) * 1000 + 1000);
      const available = /\b[1-9]\d* slots? available now/i.test(status);
      const delayMs = available
        ? 1000
        : slots.length
          ? Math.min(...slots)
          : 30000;
      end?.('success', { delayMs, slotKnown: available || slots.length > 0 });
      return delayMs;
    } catch (error) {
      end?.(this.signal.aborted ? 'cancelled' : 'error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.signal.throwIfAborted();
      return 30000;
    }
  }
  private async fetchQuery(
    query: string,
    stage: string,
    splitOnTimeout: boolean,
  ): Promise<OSMElement[]> {
    let last: unknown;
    const attempts = MAP_ENDPOINTS.map(() => 0);
    for (let attempt = 0; attempt < MAP_ENDPOINTS.length * 2; attempt++) {
      this.signal.throwIfAborted();
      if (
        this.unavailable.has(this.preferred) ||
        attempts[this.preferred] >= 2
      ) {
        const available = MAP_ENDPOINTS.findIndex(
          (_, i) => !this.unavailable.has(i) && attempts[i] < 2,
        );
        if (available < 0) break;
        this.preferred = available;
      }
      const endpointIndex = this.preferred;
      const endpoint = MAP_ENDPOINTS[endpointIndex];
      attempts[endpointIndex]++;
      const delayMs = this.readyAt[endpointIndex] - Date.now();
      if (delayMs > 0) {
        const waitEnd = this.log?.start(`${stage} / повтор`, {
          endpoint,
          delayMs,
        });
        try {
          await abortableDelay(delayMs, this.signal);
          waitEnd?.();
        } catch (error) {
          waitEnd?.('cancelled');
          throw error;
        }
      }
      const end = this.log?.start(stage, {
        endpoint,
        attempt: attempt + 1,
        endpointAttempt: attempts[endpointIndex],
        clientTimeoutMs: MAP_REQUEST_TIMEOUT_MS,
        idleTimeoutMs: MAP_IDLE_TIMEOUT_MS,
        totalTimeoutMs: MAP_TOTAL_TIMEOUT_MS,
        serverTimeoutSeconds: 25,
      });
      let httpStatus: number | undefined,
        headersMs: number | undefined,
        responseChars: number | undefined,
        serverMessage: string | undefined;
      const metrics: DownloadMetrics = { receivedBytes: 0 };
      try {
        const { response, body } = await downloadMap(
          endpoint,
          {
            method: 'POST',
            body: new URLSearchParams({
              data: `[out:json][timeout:25];${query}`,
            }),
            signal: this.signal,
          },
          metrics,
        );
        headersMs = metrics.headersMs;
        httpStatus = response.status;
        if (!response.ok) {
          const after = response.headers.get('retry-after'),
            seconds = Number(after),
            retryAfterMs = after
              ? Number.isFinite(seconds)
                ? seconds * 1000
                : Date.parse(after) - Date.now()
              : response.status === 429
                ? await this.slotDelay(endpoint, stage)
                : 5000;
          serverMessage = body.slice(0, 1024) || undefined;
          throw new MapRequestError(
            `Сервер карт ответил ${response.status}.`,
            executionLimit(serverMessage),
            response.status,
            Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 30000,
          );
        }
        responseChars = body.length;
        const readMs = metrics.readMs,
          parseStart = performance.now();
        const json = JSON.parse(body) as {
            remark?: string;
            elements?: OSMElement[];
          },
          parseMs = Math.round(performance.now() - parseStart);
        serverMessage = json.remark?.slice(0, 1024);
        if (json.remark || !Array.isArray(json.elements))
          throw new MapRequestError(
            'Сервер карт не успел подготовить участок.',
            executionLimit(json.remark),
          );
        this.signal.throwIfAborted();
        end?.('success', {
          httpStatus,
          headersMs,
          readMs,
          parseMs,
          responseChars,
          elements: json.elements.length,
          ...metrics,
        });
        await this.save(query, json.elements);
        return json.elements;
      } catch (error) {
        httpStatus ??= metrics.httpStatus;
        end?.(this.signal.aborted ? 'cancelled' : 'error', {
          httpStatus,
          headersMs,
          responseChars,
          serverMessage,
          error: error instanceof Error ? error.message : String(error),
          ...metrics,
        });
        this.signal.throwIfAborted();
        const timeout = error instanceof Error && error.name === 'TimeoutError';
        last =
          error instanceof MapDownloadError
            ? new MapRequestError(error.message, error.split)
            : timeout
              ? new MapRequestError('Сервер карт не ответил за 35 секунд.')
              : error;
        // Дробим тяжёлые ответы и обрыв чтения после заголовков. Ожидание
        // заголовков, 504 диспетчера и 429 не означают большой объём карты.
        if (splitOnTimeout && last instanceof MapRequestError && last.split)
          throw last;
        if (
          last instanceof MapRequestError &&
          last.split &&
          attempts[endpointIndex] >= 2
        )
          break;
        if (last instanceof MapRequestError && last.status === 400) break;
        if (httpStatus === 429) {
          // Соблюдаем квоту всей очереди; смена сервера не обходит ограничение.
          this.readyAt[endpointIndex] =
            Date.now() +
            (last instanceof MapRequestError ? last.retryAfterMs : 5000);
          if (attempts[endpointIndex] >= 2) break;
        } else if (
          ((httpStatus === 504 &&
            /Dispatcher_Client/i.test(serverMessage || '')) ||
            (last instanceof MapRequestError && last.split)) &&
          attempts[endpointIndex] < 2
        ) {
          this.readyAt[endpointIndex] =
            Date.now() +
            (last instanceof MapRequestError ? last.retryAfterMs : 5000);
        } else {
          // Неответивший сервер больше не используем в этой загрузке.
          this.unavailable.add(endpointIndex);
          this.preferred = (endpointIndex + 1) % MAP_ENDPOINTS.length;
          // Обычный gateway error означает сбой endpoint, а не квоту.
          if (![502, 503, 504].includes(httpStatus || 0))
            this.readyAt[this.preferred] = Math.max(
              this.readyAt[this.preferred],
              Date.now() + 2500,
            );
        }
      }
    }
    throw new Error(
      `Не удалось загрузить карту. ${last instanceof Error ? last.message : 'Ошибка соединения.'} Попробуйте ещё раз.`,
    );
  }
  async seedCell(box: MapBox, elements: OSMElement[], savedAt: number) {
    this.signal.throwIfAborted();
    const query = mapCellQuery(box),
      current = await this.store?.get(this.key(query));
    this.signal.throwIfAborted();
    if (!fresh(current) || current.split)
      await this.store?.put(this.key(query), { elements, savedAt });
  }
  async cell(
    box: MapBox,
    stage: string,
    depth = 0,
    splitFirst = false,
  ): Promise<OSMElement[]> {
    const query = mapCellQuery(box);
    if (depth === 0 && this.store) {
      this.signal.throwIfAborted();
      const parent = await this.store.get(this.key(query));
      if (!fresh(parent)) {
        // Совместимость с уже скачанными частями старого загрузчика, который
        // ещё не записывал план. Готовую родительскую карту всегда предпочитаем.
        const children = await Promise.all(
          splitMapBox(box).map((part) =>
            this.store!.get(this.key(mapCellQuery(part))),
          ),
        );
        this.signal.throwIfAborted();
        if (children.some((child) => fresh(child) && !child.split))
          await this.store.put(this.key(query), {
            elements: [],
            split: true,
            savedAt: Date.now(),
          });
      }
    }
    try {
      if (splitFirst && depth === 0) {
        const cached = await this.cached(query, stage);
        if (cached && !cached.split) return cached.elements;
        throw new MapRequestError(
          'Загружаем участок четырьмя малыми частями.',
          true,
        );
      }
      return await this.request(query, stage, depth < 1);
    } catch (error) {
      this.signal.throwIfAborted();
      if (depth >= 1 || !(error instanceof MapRequestError) || !error.split)
        throw error;
      // План сохраняется до первой части, поэтому после обрыва не повторяем
      // заведомо тяжёлый родительский запрос; пустой массив не является картой.
      await this.store?.put(this.key(query), {
        elements: [],
        split: true,
        savedAt: Date.now(),
      });
      const end = this.log?.start(`${stage} / делим участок`, { parts: 4 }),
        merged = new Map<string, OSMElement>();
      try {
        for (const [i, part] of splitMapBox(box).entries())
          for (const e of await this.cell(part, `${stage}.${i + 1}`, depth + 1))
            merged.set(`${e.type}/${e.id}`, e);
        const elements = [...merged.values()];
        await this.save(query, elements);
        end?.('success', { elements: elements.length });
        return elements;
      } catch (error) {
        end?.(this.signal.aborted ? 'cancelled' : 'error', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }
  }
}
