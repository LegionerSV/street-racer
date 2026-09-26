import { seeded } from './geo';

export type CarKind =
  | 'sport'
  | 'sedan'
  | 'hatch'
  | 'suv'
  | 'wagon'
  | 'van'
  | 'truck';
export type PaintFinish = 'standard' | 'aged';
export type VehicleProfile = {
  kind: CarKind;
  label: string;
  reference: string;
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  track: number;
  wheelRadius: number;
  rideHeight: number;
  aged: boolean;
  weights: [number, number];
};

function profile(
  kind: CarKind,
  label: string,
  reference: string,
  dimensions: [number, number, number, number],
  details: Partial<VehicleProfile> = {},
): VehicleProfile {
  const [length, width, height, wheelbase] = dimensions;
  return {
    kind,
    label,
    reference,
    length,
    width,
    height,
    wheelbase,
    track: width - 0.24,
    wheelRadius: kind === 'suv' ? 0.36 : 0.32,
    rideHeight: 0.79,
    aged: false,
    weights: [3, 3],
    ...details,
  };
}

// Доли — художественная смесь потока, не проценты зарегистрированного автопарка.
export const VEHICLE_PROFILES = {
  'sport-coupe': profile(
    'sport',
    'Спортивное купе',
    'Собирательное купе',
    [4.34, 1.84, 1.4, 2.75],
    { wheelRadius: 0.37, weights: [0, 0] },
  ),
  'city-sedan': profile(
    'sedan',
    'Городской седан',
    'Kia Rio',
    [4.4, 1.74, 1.47, 2.6],
    { weights: [13, 11] },
  ),
  'stream-sedan': profile(
    'sedan',
    'Плавный седан',
    'Hyundai Solaris',
    [4.4, 1.73, 1.47, 2.6],
    { weights: [11, 10] },
  ),
  'classic-sedan': profile(
    'sedan',
    'Строгий седан',
    'Volkswagen Polo',
    [4.39, 1.7, 1.47, 2.55],
    { aged: true, weights: [11, 10] },
  ),
  'urban-hatch': profile(
    'hatch',
    'Городской хэтчбек',
    'Ford Focus',
    [4.34, 1.82, 1.5, 2.65],
    { aged: true, weights: [10, 14] },
  ),
  'long-liftback': profile(
    'sedan',
    'Длинный лифтбек',
    'Skoda Octavia',
    [4.66, 1.81, 1.48, 2.69],
    { weights: [9, 9] },
  ),
  'executive-sedan': profile(
    'sedan',
    'Большой седан',
    'Toyota Camry',
    [4.85, 1.84, 1.48, 2.78],
    { weights: [8, 3] },
  ),
  'trail-suv': profile(
    'suv',
    'Семейный кроссовер',
    'Nissan X-Trail',
    [4.64, 1.82, 1.71, 2.71],
    { weights: [8, 3] },
  ),
  'angular-suv': profile(
    'suv',
    'Угловатый кроссовер',
    'Toyota RAV4',
    [4.6, 1.85, 1.69, 2.69],
    { weights: [8, 5] },
  ),
  'square-suv': profile(
    'suv',
    'Строгий кроссовер',
    'Volkswagen Tiguan',
    [4.49, 1.84, 1.67, 2.68],
    { weights: [8, 8] },
  ),
  'compact-suv': profile(
    'suv',
    'Компактный кроссовер',
    'Nissan Qashqai',
    [4.38, 1.81, 1.59, 2.64],
    { weights: [7, 4] },
  ),
  'budget-sedan': profile(
    'sedan',
    'Практичный седан',
    'Renault Logan',
    [4.29, 1.74, 1.53, 2.63],
    { aged: true, weights: [3, 9] },
  ),
  'utility-suv': profile(
    'suv',
    'Утилитарный кроссовер',
    'Renault Duster',
    [4.31, 1.82, 1.69, 2.67],
    { aged: true, weights: [3, 7] },
  ),
  'touring-suv': profile(
    'suv',
    'Большой кроссовер',
    'Mitsubishi Outlander',
    [4.69, 1.81, 1.68, 2.67],
    { weights: [4, 7] },
  ),
  'short-suv': profile(
    'suv',
    'Короткий кроссовер',
    'Hyundai Creta',
    [4.27, 1.78, 1.63, 2.59],
    { weights: [4, 7] },
  ),
  'family-wagon': profile(
    'wagon',
    'Семейный универсал',
    'Lada Largus',
    [4.47, 1.75, 1.67, 2.9],
    { aged: true, weights: [3, 5] },
  ),
  'domestic-sedan': profile(
    'sedan',
    'Современный седан',
    'Lada Vesta',
    [4.41, 1.76, 1.5, 2.64],
    { weights: [4, 5] },
  ),
  'metro-suv': profile(
    'suv',
    'Новый городской кроссовер',
    'Haval Jolion',
    [4.47, 1.84, 1.62, 2.7],
    { weights: [6, 6] },
  ),
  'coupe-suv': profile(
    'suv',
    'Кроссовер с покатой крышей',
    'Belgee X50 / Geely Coolray',
    [4.33, 1.8, 1.61, 2.6],
    { weights: [5, 5] },
  ),
  'delivery-van': profile(
    'van',
    'Развозной фургон',
    'Ford Transit',
    [5.15, 1.98, 2.3, 3.1],
    {
      aged: true,
      wheelRadius: 0.36,
      weights: [4, 4],
    },
  ),
  'small-truck': profile(
    'truck',
    'Малотоннажный грузовик',
    'ГАЗель Next',
    [5.65, 2.06, 2.16, 3.15],
    {
      aged: true,
      wheelRadius: 0.38,
      rideHeight: 0.9,
      weights: [3, 3],
    },
  ),
  'box-truck': profile(
    'truck',
    'Среднетоннажный грузовик',
    'ГАЗон Next',
    [6.65, 2.35, 3.05, 3.8],
    {
      aged: true,
      wheelRadius: 0.47,
      rideHeight: 1.08,
      weights: [2, 2],
    },
  ),
} satisfies Record<string, VehicleProfile>;
export type VehicleModelId = keyof typeof VEHICLE_PROFILES;
export const DEFAULT_MODELS: Record<CarKind, VehicleModelId> = {
  sport: 'sport-coupe',
  sedan: 'city-sedan',
  hatch: 'urban-hatch',
  suv: 'square-suv',
  wagon: 'family-wagon',
  van: 'delivery-van',
  truck: 'small-truck',
};

const colors = [
  '#c5c8c7',
  '#b2b6b8',
  '#343b42',
  '#e3e0d7',
  '#384d63',
  '#704339',
  '#647567',
  '#a29680',
];
export function trafficAppearance(id: number, city: 'moscow' | 'spb') {
  const entries = Object.entries(VEHICLE_PROFILES) as [
    VehicleModelId,
    VehicleProfile,
  ][];
  const column = city === 'spb' ? 1 : 0,
    total = entries.reduce((sum, [, p]) => sum + p.weights[column], 0);
  let ticket = seeded(id * 941 + 17) * total;
  const model = entries.find(([, p]) => {
    ticket -= p.weights[column];
    return ticket < 0;
  })![0];
  const p = VEHICLE_PROFILES[model];
  const finish: PaintFinish =
    p.aged && seeded(id * 379 + 53) < 0.55 ? 'aged' : 'standard';
  return {
    model,
    kind: p.kind,
    color: colors[Math.floor(seeded(id * 631 + 31) * colors.length)],
    finish,
  };
}
