import { expect, it, vi } from 'vitest';
import {
  InternalTexture,
  InternalTextureSource,
  NullEngine,
  Scene,
  SphericalPolynomial,
} from '@babylonjs/core';
import {
  environmentFaces,
  makeEnvironment,
  updateVehicleEnvironment,
} from './vehicle-environment';

it('смена дня и ночи сбрасывает рассеянное освещение, неизменная погода сохраняет кэш', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const internal = new InternalTexture(engine, InternalTextureSource.CubeRaw);
  vi.spyOn(engine, 'createRawCubeTexture').mockReturnValue(internal);
  const upload = vi
    .spyOn(engine, 'updateRawCubeTexture')
    .mockImplementation(() => {});
  const texture = makeEnvironment(scene);
  try {
    for (const day of [0, 1]) {
      const cached = new SphericalPolynomial();
      texture.sphericalPolynomial = cached;
      internal._sphericalPolynomialComputed = true;
      // Act
      updateVehicleEnvironment(scene, day, 0.25);
      // Assert
      expect(internal._sphericalPolynomial).toBeNull();
      expect(internal._sphericalPolynomialComputed).toBe(false);
      texture.sphericalPolynomial = cached;
      const uploads = upload.mock.calls.length;
      updateVehicleEnvironment(scene, day, 0.25);
      expect(internal._sphericalPolynomial).toBe(cached);
      expect(upload).toHaveBeenCalledTimes(uploads);
    }
  } finally {
    scene.dispose();
    engine.dispose();
    vi.restoreAllMocks();
  }
});
it('карта окружения различает небо, улицу и ночь без белой полосы по горизонту', () => {
  // Arrange / Act
  const day = environmentFaces(16, 1, 0),
    night = environmentFaces(16, 0, 0),
    cloud = environmentFaces(16, 1, 1);
  const energy = (faces: Uint8Array[]) =>
    faces.reduce(
      (sum, face) =>
        sum + face.reduce((a, v, i) => a + (i % 4 === 3 ? 0 : v), 0),
      0,
    );
  // Assert
  expect(day).toHaveLength(6);
  expect(energy(day)).toBeGreaterThan(energy(night) * 10);
  expect(day[2]).not.toEqual(day[3]);
  expect(day[0]).not.toEqual(day[1]);
  expect(day).not.toEqual(cloud);
  for (const face of [...day, ...night])
    expect(face.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(
      true,
    );
});
