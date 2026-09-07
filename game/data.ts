import type { Center, OSMElement, RegionData } from './types';
import { bounds, decodeTerrarium, toGeo, lerp } from './geo';

const DB_NAME = 'street-racer-v1';
export const CACHE_VERSION = 1;
export const regionKey = (center: Center) => `region:${CACHE_VERSION}:${center.lat.toFixed(4)}:${center.lon.toFixed(4)}:5000`;
export function validateCenter(center: Center) {
  if (!Number.isFinite(center.lat) || !Number.isFinite(center.lon) || Math.abs(center.lat) > 83.9 || Math.abs(center.lon) + 2800 / (111320 * Math.cos(center.lat * Math.PI / 180)) >= 180) throw new Error('Выберите точку между 83.9° ю. ш. и 83.9° с. ш., вдали от линии перемены дат.');
}
export async function cacheGet<T>(key: string): Promise<T | undefined> { return database<T>(key); }
export async function cachePut<T>(key: string, value: T): Promise<void> { await database(key, value); }
function database<T>(key: string, value?: T): Promise<T | undefined> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(undefined); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('cache');
    request.onerror = () => resolve(undefined);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction('cache', value === undefined ? 'readonly' : 'readwrite');
        const operation = value === undefined ? tx.objectStore('cache').get(key) : tx.objectStore('cache').put(value, key);
        let result: T | undefined;
        operation.onsuccess = () => { result = value === undefined ? operation.result : undefined; };
        tx.oncomplete = () => { db.close(); resolve(result); };
        tx.onerror = tx.onabort = () => { db.close(); resolve(undefined); };
      } catch { db.close(); resolve(undefined); }
    };
  });
}
export async function abortableDelay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
export async function overpass(query: string, signal: AbortSignal): Promise<OSMElement[]> {
  let last = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted();
    try {
      const response = await fetch(ENDPOINTS[attempt % 2], { method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:60];${query}` }), signal: AbortSignal.any([signal, AbortSignal.timeout(75000)]) });
      if (!response.ok) throw new Error(`Сервер карт ответил ${response.status}.`);
      const json = await response.json() as { remark?: string; elements?: OSMElement[] };
      if (json.remark || !Array.isArray(json.elements)) throw new Error('Сервер карт не успел подготовить участок.');
      return json.elements;
    } catch (error) {
      signal.throwIfAborted(); last = error instanceof Error ? error.message : 'Ошибка соединения.';
      if (attempt < 2) await abortableDelay(2500 * (attempt + 1), signal);
    }
  }
  throw new Error(`Не удалось загрузить карту. ${last} Попробуйте ещё раз.`);
}
function tileCoord(lat: number, lon: number, z: number) { const n = 2 ** z, r = lat * Math.PI / 180; return { x: (lon + 180) / 360 * n, y: (1 - Math.asinh(Math.tan(r)) / Math.PI) / 2 * n }; }
async function loadElevations(center: Center, signal: AbortSignal, progress: (text: string, percent: number) => void) {
  const z = 12, box = bounds(center), nw = tileCoord(box.north, box.west, z), se = tileCoord(box.south, box.east, z);
  const images = new Map<string, Uint8ClampedArray>(), jobs: [number, number][] = [];
  for (let x = Math.floor(nw.x); x <= Math.floor(se.x); x++) for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) jobs.push([x, y]);
  if (jobs.length > 100) throw new Error('Для этого участка слишком много данных высот. Выберите территорию ближе к экватору.');
  let finished = 0;
  const queue = [...jobs];
  await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
    while (queue.length) {
      signal.throwIfAborted();
      const [x, y] = queue.shift()!, key = `height:${z}/${x}/${y}`;
      let pixels = await cacheGet<Uint8ClampedArray>(key);
      if (!pixels) {
        const response = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
        if (!response.ok) throw new Error('Не удалось загрузить рельеф. Повторите попытку.');
        const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(bitmap, 0, 0); bitmap.close(); pixels = ctx.getImageData(0, 0, 256, 256).data;
        await cachePut(key, pixels);
      }
      images.set(`${x},${y}`, pixels); finished++; progress('Загружаем рельеф', 65 + 18 * finished / jobs.length);
    }
  }));
  const width = 257, size = 5600, values = new Float32Array(width * width);
  function height(px: number, py: number) {
    const x = Math.floor(px / 256), y = Math.floor(py / 256), pixels = images.get(`${x},${y}`);
    if (!pixels) return null;
    const index = ((py - y * 256) * 256 + px - x * 256) * 4;
    return decodeTerrarium(pixels[index], pixels[index + 1], pixels[index + 2]);
  }
  for (let j = 0; j < width; j++) for (let i = 0; i < width; i++) {
    const p = toGeo({ x: (i / (width - 1) - .5) * size, y: 0, z: (j / (width - 1) - .5) * size }, center), t = tileCoord(p.lat, p.lon, z);
    const px = t.x * 256, py = t.y * 256, ix = Math.floor(px), iy = Math.floor(py);
    const a = height(ix, iy);
    if (a === null || !Number.isFinite(a)) throw new Error('Для выбранной территории нет полных данных высот.');
    const b = height(ix + 1, iy) ?? a, c = height(ix, iy + 1) ?? a, d = height(ix + 1, iy + 1) ?? a;
    values[j * width + i] = lerp(lerp(a, b, px - ix), lerp(c, d, px - ix), py - iy);
  }
  return { width, size, values };
}
export async function loadRegion(center: Center, signal: AbortSignal, progress: (text: string, percent: number) => void): Promise<RegionData> {
  validateCenter(center); signal.throwIfAborted();
  const cached = await cacheGet<RegionData>(regionKey(center));
  signal.throwIfAborted();
  if (cached) { progress('Открываем сохранённый район', 83); return cached; }
  const b = bounds(center), bbox = `${b.south},${b.west},${b.north},${b.east}`;
  progress('Загружаем дорожную сеть', 5);
  const roadData = await overpass(`(way["highway"](${bbox});node["highway"="traffic_signals"](${bbox});relation["type"="restriction"](${bbox}););(._;>;);out body;`, signal);
  const merged = new Map(roadData.map(e => [`${e.type}/${e.id}`, e]));
  for (let q = 0; q < 4; q++) {
    progress(`Загружаем кварталы · ${q + 1} из 4`, 15 + q * 11);
    const south = q < 2 ? b.south : center.lat, north = q < 2 ? center.lat : b.north;
    const west = q % 2 === 0 ? b.west : center.lon, east = q % 2 === 0 ? center.lon : b.east;
    const bb = `${south},${west},${north},${east}`;
    const elements = await overpass(`(way["building"](${bb});way["building:part"](${bb});relation["building"](${bb});nwr["natural"~"^(water|wood|tree)$"](${bb});nwr["landuse"~"^(forest|grass|meadow|reservoir)$"](${bb});nwr["leisure"="park"](${bb}););(._;>;);out body;`, signal);
    for (const e of elements) merged.set(`${e.type}/${e.id}`, e);
  }
  progress('Определяем сторону движения', 61);
  const areas = await overpass(`is_in(${center.lat},${center.lon})->.a;area.a["admin_level"="2"];out tags;`, signal);
  const leftCountries = new Set('GB IE AU NZ JP IN PK BD LK NP BT TH MY SG ID BN TL ZA BW LS SZ NA ZM ZW MW MZ TZ KE UG MU SC MT CY JM BS BB TT AG DM GD KN LC VC GY SR FJ PG SB TO WS KI TV NR MV HK MO'.split(' '));
  const country = areas.find(e => e.tags?.['ISO3166-1'])?.tags?.['ISO3166-1'];
  const explicit = areas.find(e => e.tags?.driving_side)?.tags?.driving_side;
  if (!country && !explicit) throw new Error('Не удалось определить сторону движения для участка. Выберите точку на суше и повторите.');
  const drivingSide = explicit === 'left' || (!explicit && leftCountries.has(country!)) ? 'left' : 'right';
  const elevation = await loadElevations(center, signal, progress);
  signal.throwIfAborted();
  const region: RegionData = { center, elements: [...merged.values()], elevation, drivingSide, fetchedAt: new Date().toISOString() };
  await cachePut(regionKey(center), region);
  return region;
}
