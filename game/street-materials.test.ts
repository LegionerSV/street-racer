import { expect, it } from 'vitest';
import { NullEngine, Scene } from '@babylonjs/core';
import { streetMaterials } from './street-materials';
import {
  asphaltSurface,
  facadeSurface,
  graniteSurface,
} from './surface-textures';

it('гранит имеет нейтральное зерно и повторяется детерминированно', () => {
  // Arrange
  const size = 64;
  // Act
  const pixels = graniteSurface(size);
  // Assert
  expect(pixels).toEqual(graniteSurface(size));
  expect(pixels).toHaveLength(size * size * 4);
  const shades = Array.from({ length: size * size }, (_, i) => pixels[i * 4]);
  expect(new Set(shades).size).toBeGreaterThan(15);
  expect(Math.min(...shades)).toBeGreaterThan(100);
  expect(Math.max(...shades)).toBeLessThan(255);
  expect(
    Array.from({ length: size * size }, (_, i) => pixels[i * 4 + 3]).every(
      (a) => a === 255,
    ),
  ).toBe(true);
});

it('дневная отделка различима и не добавляет цвет поверх оттенка OSM', () => {
  // Arrange
  const size = 128;
  const wall = (pixels: Uint8Array, x: number, y: number) =>
    pixels[(y * size + x) * 4];

  // Act
  const brick = facadeSurface('brick', size);
  const stone = facadeSurface('stone', size);
  const modern = facadeSurface('modern', size);

  // Assert
  for (const { diffuse } of [brick, stone, modern])
    for (let y = 4; y <= 11; y++)
      for (let x = 20; x <= 44; x++) {
        const i = (y * size + x) * 4;
        expect([diffuse[i], diffuse[i + 1], diffuse[i + 2]]).toEqual([
          diffuse[i],
          diffuse[i],
          diffuse[i],
        ]);
      }
  expect(
    wall(brick.diffuse, 25, 7) - wall(brick.diffuse, 25, 8),
  ).toBeGreaterThan(50);
  expect(
    Math.abs(wall(stone.diffuse, 24, 8) - wall(stone.diffuse, 24, 7)),
  ).toBeGreaterThan(12);
  expect(
    Math.abs(wall(modern.diffuse, 24, 8) - wall(modern.diffuse, 25, 8)),
  ).toBeGreaterThan(25);
  expect(brick.normal).not.toEqual(stone.normal);
  expect(stone.normal).not.toEqual(modern.normal);
});
it('деревянный фасад показывает горизонтальные доски и оконные рамы', () => {
  // Arrange
  const size = 128;
  const pixel = (data: Uint8Array, x: number, y: number) =>
    data[(y * size + x) * 4];
  // Act
  const wood = facadeSurface('wood', size);
  // Assert
  expect(
    Math.abs(pixel(wood.diffuse, 25, 7) - pixel(wood.diffuse, 25, 8)),
  ).toBeGreaterThan(25);
  expect(pixel(wood.diffuse, 25, 20)).not.toBe(pixel(wood.diffuse, 25, 30));
  expect(wood.normal).toHaveLength(size * size * 4);
});

it('фасады сохраняют цвет и отделку без мерцающего normal map', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    // Act
    const { facades, bareFacades } = streetMaterials(scene);

    // Assert
    expect(facades).toHaveLength(4);
    expect(
      facades.every(
        (material) => material.diffuseTexture && material.emissiveTexture,
      ),
    ).toBe(true);
    expect(
      [...facades, ...bareFacades].every((material) =>
        [material.diffuseTexture, material.emissiveTexture].every(
          (texture) => texture?.anisotropicFilteringLevel === 16,
        ),
      ),
    ).toBe(true);
    expect(
      [...facades, ...bareFacades].every((material) => !material.bumpTexture),
    ).toBe(true);
    expect(bareFacades).toHaveLength(4);
    expect(
      bareFacades.every(
        (material) => material.diffuseTexture && material.emissiveTexture,
      ),
    ).toBe(true);
    expect(
      scene.materials.filter((material) => material.name.startsWith('facade-')),
    ).toHaveLength(8);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('асфальт имеет разную фактуру и блеск, сохраняя матовые и мокрые участки', () => {
  // Arrange
  const size = 128;

  // Act
  const { colour, normal, specular } = asphaltSurface(size);
  const pixel = (data: Uint8Array, index: number) =>
    data.slice(index * 4, index * 4 + 3).join(',');

  // Assert
  expect(colour).toHaveLength(size * size * 4);
  expect(normal).toHaveLength(size * size * 4);
  expect(specular).toHaveLength(size * size * 4);
  expect(
    new Set([0, 3, 29, 513, 1603].map((index) => pixel(colour, index))).size,
  ).toBeGreaterThan(2);
  expect(
    new Set([0, 3, 29, 513, 1603].map((index) => pixel(normal, index))).size,
  ).toBeGreaterThan(2);
  expect(
    new Set([0, 3, 29, 513, 1603].map((index) => pixel(specular, index))).size,
  ).toBeGreaterThan(2);
  const shades = Array.from(
    { length: size * size },
    (_, index) => colour[index * 4],
  );
  expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(70);
  expect(Math.min(...specular)).toBeGreaterThan(0);
});
