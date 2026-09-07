import { expect, it } from 'vitest';
import { weatherAt, tyreGrip } from './weather';
import { smoothPath, samplePath } from './driving-path';
it('меняет день и ночь по игровому времени, плавно переводит погоду', () => {
  // Arrange
  const day = weatherAt(0, { hour: 12, weather: 'clear' }), night = weatherAt(0, { hour: 0, weather: 'clear' });
  // Act
  const before = weatherAt(239.99, { hour: 12, weather: 'dynamic' }), after = weatherAt(240.01, { hour: 12, weather: 'dynamic' });
  // Assert
  expect(day.sunHeight).toBeGreaterThan(.8); expect(night.sunHeight).toBeLessThan(-.8);
  expect(Math.abs(before.rain - after.rain)).toBeLessThan(.001);
  expect(weatherAt(600, { hour: 12, weather: 'clear' }).hour).toBeCloseTo(0);
  expect(day.label).toBe('Ясно'); expect(weatherAt(0, { weather: 'rain' }).label).toBe('Дождь');
});
it('мокрый асфальт уменьшает сцепление, трава снижает его дополнительно', () => {
  // Arrange / Act
  const dry = tyreGrip(0, false), wet = tyreGrip(1, false), grass = tyreGrip(1, true);
  // Assert
  expect(wet).toBeLessThan(dry * .75); expect(grass).toBeLessThan(wet); expect(grass).toBeGreaterThan(.15);
});
it('скругляет реальную траекторию прямого угла с непрерывной касательной', () => {
  // Arrange
  const path = smoothPath([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 50 }, { x: 50, y: 0, z: 50 }], 9);
  // Act
  const samples = Array.from({ length: Math.floor(path.length * 10) }, (_, i) => samplePath(path, i / 10));
  // Assert
  for (let i = 1; i < samples.length; i++) expect(Math.abs(Math.atan2(Math.sin(samples[i].heading - samples[i - 1].heading), Math.cos(samples[i].heading - samples[i - 1].heading)))).toBeLessThan(.1);
  expect(samples.some(s => s.point.x > 1 && s.point.x < 8 && s.point.z > 42 && s.point.z < 49)).toBe(true);
  expect(samples.every(s => Number.isFinite(s.point.y))).toBe(true);
});
