import { clamp, smooth } from './geo';
export type WeatherOptions = { hour?: number; weather?: 'dynamic' | 'clear' | 'rain' | 'overcast' };
export function weatherAt(seconds: number, options: WeatherOptions = {}) {
  const hour = (((options.hour ?? 17) + seconds / 50) % 24 + 24) % 24;
  const cycle = [0, .2, .85, 1, .35, 0], block = Math.floor(seconds / 180), blend = smooth((seconds % 180) / 180);
  const storm = cycle[((block % cycle.length) + cycle.length) % cycle.length] * (1 - blend) + cycle[((block + 1) % cycle.length + cycle.length) % cycle.length] * blend;
  const rain = options.weather === 'rain' ? 1 : options.weather === 'clear' || options.weather === 'overcast' ? 0 : clamp((storm - .25) / .75, 0, 1);
  const clouds = options.weather === 'overcast' ? .9 : options.weather === 'clear' ? .16 : options.weather === 'rain' ? 1 : .16 + storm * .84;
  const sunHeight = Math.sin((hour - 6) / 24 * Math.PI * 2);
  const daylight = smooth((sunHeight + .12) / .45), wetness = options.weather === 'clear' ? 0 : Math.max(rain, clouds > .5 ? (clouds - .5) * .7 : 0);
  return { hour, rain, clouds, wetness, sunHeight, daylight, label: rain > .15 ? 'Дождь' : clouds > .55 ? 'Облачно' : 'Ясно' };
}
export const tyreGrip = (wetness: number, offRoad: boolean) => (1 - clamp(wetness, 0, 1) * .4) * (offRoad ? .58 : 1);
