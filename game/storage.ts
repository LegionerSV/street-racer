import type { Center, Settings } from './types';
export const defaultSettings: Settings = { quality: 'high', volume: .45, traffic: 'city', weather: 'dynamic', hour: 17, touchControls: 'auto', navigator: true };
export function readSettings(mobile=false): Settings {
  const fallbackQuality=mobile?'mobile':'high';
  try { const raw = JSON.parse(localStorage.getItem('street-racer:settings') || '{}'); return { touchControls: ['auto','on','off'].includes(raw.touchControls) ? raw.touchControls : 'auto', navigator: raw.navigator !== false, weather: ['dynamic', 'clear', 'rain', 'overcast'].includes(raw.weather) ? raw.weather : 'dynamic', hour: Number.isFinite(raw.hour) ? Math.max(0, Math.min(23, raw.hour)) : 17, traffic: ['light', 'city', 'rush'].includes(raw.traffic) ? raw.traffic : 'city', quality: ['mobile', 'low', 'medium', 'high'].includes(raw.quality) ? raw.quality : fallbackQuality, volume: Number.isFinite(raw.volume) ? Math.min(1, Math.max(0, raw.volume)) : .45 }; } catch { return {...defaultSettings,quality:fallbackQuality}; }
}
export function saveSettings(settings: Settings) { try { localStorage.setItem('street-racer:settings', JSON.stringify(settings)); } catch { /* Настройки не должны прерывать игру при заполненном хранилище. */ } }
export function recordKey(center: Center, route: string) { return `street-racer:record:${center.lat.toFixed(4)},${center.lon.toFixed(4)}:${route}`; }
export function saveRecord(key: string, time: number): { best: number; improved: boolean } {
  try {
    const old = Number(localStorage.getItem(key)) || Infinity, best = Math.min(old, time);
    localStorage.setItem(key, String(best)); return { best, improved: time < old };
  } catch { return { best: time, improved: false }; }
}
