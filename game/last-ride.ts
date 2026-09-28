import { validateCenter } from './data';
import type { Center } from './types';

export const LAST_RIDE_KEY = 'street-racer:last-ride:v1';

export function readLastRide(): Center | null {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_RIDE_KEY) || 'null');
    if (value?.version !== 1) return null;
    const center = { lat: value.lat, lon: value.lon };
    validateCenter(center);
    return center;
  } catch {
    return null;
  }
}

export function saveLastRide(center: Center): void {
  try {
    validateCenter(center);
    localStorage.setItem(
      LAST_RIDE_KEY,
      JSON.stringify({ version: 1, ...center }),
    );
  } catch {
    // Недоступное хранилище не мешает поездке.
  }
}
