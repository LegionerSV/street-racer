import {
  RawTexture,
  Texture,
  Constants,
  StandardMaterial,
  Color3,
  type Scene,
} from '@babylonjs/core';
import { seeded } from './geo';
import { facadeSurface } from './surface-textures';
function texture(scene: Scene, name: string, pixels: Uint8Array, size: number) {
  const t = new RawTexture(
    pixels,
    size,
    size,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  t.name = name;
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  // Длинные фасады почти параллельны взгляду из машины. Низкая
  // анизотропия превращает швы кирпича и normal map в мерцающие полосы.
  t.anisotropicFilteringLevel = 16;
  return t;
}
export function streetMaterials(scene: Scene) {
  const makeFacades = (windows: boolean) =>
      ['brick', 'stone', 'modern', 'wood'].map((style) => {
        const size = 128;
        const { diffuse, emission } = facadeSurface(
          style as 'brick' | 'stone' | 'modern' | 'wood',
          size,
          windows,
        );
        const suffix = windows ? 'windows' : 'solid',
          mat = new StandardMaterial(`facade-${style}-${suffix}`, scene);
        mat.diffuseTexture = texture(
          scene,
          `${style}-${suffix}`,
          diffuse,
          size,
        );
        mat.emissiveTexture = texture(
          scene,
          `${style}-${suffix}-night`,
          emission,
          size,
        );
        for (const t of [
          mat.diffuseTexture,
          mat.emissiveTexture,
        ] as RawTexture[])
          t.uScale = t.vScale = 0.5;
        mat.backFaceCulling = false;
        mat.twoSidedLighting = true;
        mat.maxSimultaneousLights = 8;
        mat.specularColor = new Color3(0.08, 0.09, 0.1);
        return mat;
      }),
    facades = makeFacades(true),
    bareFacades = makeFacades(false);
  const size = 128,
    pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const seam = x % 32 < 1 || y % 32 < 1,
        n = seam ? 150 : 215 + seeded(x + y * size) * 30;
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = n;
      pixels[i + 3] = 255;
    }
  const sidewalks = new StandardMaterial('sidewalks', scene);
  sidewalks.diffuseTexture = texture(scene, 'paving-stones', pixels, size);
  sidewalks.backFaceCulling = false;
  sidewalks.twoSidedLighting = true;
  sidewalks.maxSimultaneousLights = 8;
  sidewalks.specularColor.setAll(0.06);
  return { facades, bareFacades, sidewalks };
}
