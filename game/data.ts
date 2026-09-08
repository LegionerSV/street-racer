import type { Center, OSMElement, RegionData } from './types';
import { bounds, decodeTerrarium, toGeo, lerp } from './geo';
import { MapSource, splitMapBox } from './map-source';
import type { LoadingLog } from './loading-log';
export { abortableDelay } from './map-source';

const DB_NAME = 'street-racer-v1';
export const CACHE_VERSION = 1;
export const regionKey = (center: Center) =>
  `region:${CACHE_VERSION}:${center.lat.toFixed(4)}:${center.lon.toFixed(4)}:5000`;
export function validateCenter(center: Center) {
  if (
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lon) ||
    Math.abs(center.lat) > 83.9 ||
    Math.abs(center.lon) +
      2800 / (111320 * Math.cos((center.lat * Math.PI) / 180)) >=
      180
  )
    throw new Error(
      'Выберите точку между 83.9° ю. ш. и 83.9° с. ш., вдали от линии перемены дат.',
    );
}
export async function cacheGet<T>(key: string): Promise<T | undefined> {
  return database<T>(key);
}
export async function cachePut<T>(key: string, value: T): Promise<void> {
  await database(key, value);
}
function database<T>(key: string, value?: T): Promise<T | undefined> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(undefined);
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cache');
    request.onerror = () => resolve(undefined);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(
          'cache',
          value === undefined ? 'readonly' : 'readwrite',
        );
        const operation =
          value === undefined
            ? tx.objectStore('cache').get(key)
            : tx.objectStore('cache').put(value, key);
        let result: T | undefined;
        operation.onsuccess = () => {
          result = value === undefined ? operation.result : undefined;
        };
        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          resolve(undefined);
        };
      } catch {
        db.close();
        resolve(undefined);
      }
    };
  });
}
export async function overpass(
  query: string,
  signal: AbortSignal,
): Promise<OSMElement[]> {
  return new MapSource(signal).request(query, 'Карта');
}
function tileCoord(lat: number, lon: number, z: number) {
  const n = 2 ** z,
    r = (lat * Math.PI) / 180;
  return {
    x: ((lon + 180) / 360) * n,
    y: ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n,
  };
}
export async function loadElevations(
  center: Center,
  signal: AbortSignal,
  progress: (text: string, percent: number) => void,
  log?: LoadingLog,
  shape = { size: 5600, width: 257, offsetX: 0, offsetZ: 0 },
) {
  const sw = toGeo({x:shape.offsetX-shape.size/2,y:0,z:shape.offsetZ-shape.size/2},center), ne = toGeo({x:shape.offsetX+shape.size/2,y:0,z:shape.offsetZ+shape.size/2},center);
  const z = 12,
    box = {south:sw.lat,west:sw.lon,north:ne.lat,east:ne.lon},
    nw = tileCoord(box.north, box.west, z),
    se = tileCoord(box.south, box.east, z);
  const images = new Map<string, Uint8ClampedArray>(),
    jobs: [number, number][] = [];
  for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++)
    for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++)
      jobs.push([x, y]);
  if (jobs.length > 100)
    throw new Error(
      'Для этого участка слишком много данных высот. Выберите территорию ближе к экватору.',
    );
  let finished = 0;
  const queue = [...jobs];
  await Promise.all(
    Array.from({ length: Math.min(4, jobs.length) }, async () => {
      while (queue.length) {
        signal.throwIfAborted();
        const [x, y] = queue.shift()!,
          key = `height:${z}/${x}/${y}`;
        const end = log?.start('Тайл рельефа', { tile: `${z}/${x}/${y}` });
        try {
          let pixels = await cacheGet<Uint8ClampedArray>(key);
          const cacheHit = !!pixels;
          let httpStatus: number | undefined;
          if (!pixels) {
            const response = await fetch(
              `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
              { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) },
            );
            httpStatus = response.status;
            if (!response.ok) {
              end?.('error', { httpStatus });
              throw new Error(
                `Не удалось загрузить рельеф: сервер ответил ${response.status}. Повторите попытку.`,
              );
            }
            const bitmap = await createImageBitmap(await response.blob(), {
              colorSpaceConversion: 'none',
              premultiplyAlpha: 'none',
            });
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 256;
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            pixels = ctx.getImageData(0, 0, 256, 256).data;
            await cachePut(key, pixels);
          }
          end?.('success', { cacheHit, httpStatus });
          images.set(`${x},${y}`, pixels);
          finished++;
          progress('Загружаем рельеф', 65 + (18 * finished) / jobs.length);
        } catch (error) {
          end?.(signal.aborted ? 'cancelled' : 'error', {
            error: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      }
    }),
  );
  const { width, size } = shape,
    values = new Float32Array(width * width);
  function height(px: number, py: number) {
    const x = Math.floor(px / 256),
      y = Math.floor(py / 256),
      pixels = images.get(`${x},${y}`);
    if (!pixels) return null;
    const index = ((py - y * 256) * 256 + px - x * 256) * 4;
    return decodeTerrarium(pixels[index], pixels[index + 1], pixels[index + 2]);
  }
  for (let j = 0; j < width; j++)
    for (let i = 0; i < width; i++) {
      const p = toGeo(
          {
            x: shape.offsetX + (i / (width - 1) - 0.5) * size,
            y: 0,
            z: shape.offsetZ + (j / (width - 1) - 0.5) * size,
          },
          center,
        ),
        t = tileCoord(p.lat, p.lon, z);
      const px = t.x * 256,
        py = t.y * 256,
        ix = Math.floor(px),
        iy = Math.floor(py);
      const a = height(ix, iy);
      if (a === null || !Number.isFinite(a))
        throw new Error('Для выбранной территории нет полных данных высот.');
      const b = height(ix + 1, iy) ?? a,
        c = height(ix, iy + 1) ?? a,
        d = height(ix + 1, iy + 1) ?? a;
      values[j * width + i] = lerp(
        lerp(a, b, px - ix),
        lerp(c, d, px - ix),
        py - iy,
      );
    }
  return { width, size, values, offsetX: shape.offsetX, offsetZ: shape.offsetZ };
}
export async function loadRegion(
  center: Center,
  signal: AbortSignal,
  progress: (text: string, percent: number) => void,
  log?: LoadingLog,
): Promise<RegionData> {
  validateCenter(center);
  signal.throwIfAborted();
  const cacheEnd = log?.start('Сохранённый район');
  const cached = await cacheGet<RegionData>(regionKey(center));
  cacheEnd?.('success', { cacheHit: !!cached });
  signal.throwIfAborted();
  if (cached) {
    progress('Открываем сохранённый район', 83);
    return cached;
  }
  const control = new AbortController(),
    deadline = AbortSignal.timeout(120000),
    active = AbortSignal.any([signal, control.signal, deadline]);
  const source = new MapSource(active, log, { get: cacheGet, put: cachePut }),
    merged = new Map<string, OSMElement>(),
    parts: OSMElement[][] = [];
  let finished = 0,
    terrainProgress = 0,
    areas: OSMElement[] = [];
  const update = () =>
    progress(
      `Загружаем карту · ${finished} из 5 · рельеф ${Math.round(terrainProgress * 100)}%`,
      5 + (60 * finished) / 5 + 18 * terrainProgress,
    );
  update();
  // Два задания читают кэш независимо, но MapSource ставит сетевые обращения
  // в общую очередь с учётом квоты. Рельеф идёт параллельно с другого сервера.
  const jobs = [
    async () => {
      areas = await source.request(
        `is_in(${center.lat},${center.lon})->.a;area.a["admin_level"="2"];out tags;`,
        'Сторона движения',
      );
    },
    ...splitMapBox(bounds(center)).map((box, i) => async () => {
      parts[i] = await source.cell(box, `Карта / ${i + 1}`);
    }),
  ];
  const mapLoad = Promise.all(
    Array.from({ length: 2 }, async () => {
      while (jobs.length) {
        active.throwIfAborted();
        await jobs.shift()!();
        finished++;
        update();
      }
    }),
  );
  let elevation: RegionData['elevation'];
  try {
    [, elevation] = await Promise.all([
      mapLoad,
      loadElevations(
        center,
        active,
        (_, n) => {
          terrainProgress = (n - 65) / 18;
          update();
        },
        log,
      ),
    ]);
  } catch (error) {
    control.abort();
    signal.throwIfAborted();
    if (deadline.aborted)
      throw new Error(
        'Загрузка заняла больше двух минут. Готовые части карты сохранены; повторите попытку.',
      );
    throw error;
  }
  const leftCountries = new Set(
    'GB IE AU NZ JP IN PK BD LK NP BT TH MY SG ID BN TL ZA BW LS SZ NA ZM ZW MW MZ TZ KE UG MU SC MT CY JM BS BB TT AG DM GD KN LC VC GY SR FJ PG SB TO WS KI TV NR MV HK MO'.split(
      ' ',
    ),
  );
  const country = areas.find((e) => e.tags?.['ISO3166-1'])?.tags?.['ISO3166-1'];
  const explicit = areas.find((e) => e.tags?.driving_side)?.tags?.driving_side;
  if (!country && !explicit)
    throw new Error(
      'Не удалось определить сторону движения для участка. Выберите точку на суше и повторите.',
    );
  const drivingSide =
    explicit === 'left' || (!explicit && leftCountries.has(country!))
      ? 'left'
      : 'right';
  signal.throwIfAborted();
  for (const part of parts)
    for (const e of part) merged.set(`${e.type}/${e.id}`, e);
  const region: RegionData = {
    center,
    elements: [...merged.values()],
    elevation,
    drivingSide,
    fetchedAt: new Date().toISOString(),
  };
  if (log)
    await log.measure('Сохранение готового района', () =>
      cachePut(regionKey(center), region),
    );
  else await cachePut(regionKey(center), region);
  return region;
}
