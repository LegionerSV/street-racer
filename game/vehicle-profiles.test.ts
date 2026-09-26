import { expect, it } from 'vitest';
import { VEHICLE_PROFILES, trafficAppearance } from './vehicle-profiles';

it('автопарк включает обе городские десятки, универсал, фургон и два грузовика', () => {
  // Arrange
  const references = [
    'Rio',
    'Solaris',
    'Polo',
    'Focus',
    'Octavia',
    'X-Trail',
    'Camry',
    'RAV4',
    'Tiguan',
    'Qashqai',
    'Logan',
    'Duster',
    'Outlander',
    'Creta',
  ];
  // Act
  const profiles = Object.values(VEHICLE_PROFILES);
  // Assert
  for (const name of references)
    expect(profiles.some((p) => p.reference.includes(name))).toBe(true);
  expect(profiles.filter((p) => p.kind === 'truck')).toHaveLength(2);
  expect(profiles.some((p) => p.kind === 'wagon')).toBe(true);
  expect(profiles.some((p) => p.kind === 'van')).toBe(true);
  for (const p of profiles) {
    expect(p.wheelbase).toBeLessThan(p.length - 0.5);
    expect(p.width).toBeGreaterThan(1.6);
    expect(p.height).toBeGreaterThan(1.3);
  }
});

it('выбор воспроизводим, окраска не привязана к модели, матовость доступна старым и рабочим машинам', () => {
  // Arrange
  const ids = Array.from({ length: 2000 }, (_, i) => i + 10);
  // Act
  const fleet = ids.map((id) => trafficAppearance(id, 'spb'));
  // Assert
  expect(fleet).toEqual(ids.map((id) => trafficAppearance(id, 'spb')));
  expect(new Set(fleet.map((p) => p.model)).size).toBeGreaterThanOrEqual(20);
  expect(fleet.filter((p) => p.finish === 'aged').length).toBeGreaterThan(150);
  for (const car of fleet.filter((p) => p.finish === 'aged'))
    expect(VEHICLE_PROFILES[car.model].aged).toBe(true);
  expect(
    new Set(fleet.filter((p) => p.model === 'city-sedan').map((p) => p.color))
      .size,
  ).toBeGreaterThan(3);
  expect(fleet).not.toEqual(ids.map((id) => trafficAppearance(id, 'moscow')));
});
