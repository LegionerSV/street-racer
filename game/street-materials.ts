import {
  RawTexture,
  Texture,
  Constants,
  StandardMaterial,
  Color3,
  type Scene,
} from '@babylonjs/core';
import { seeded } from './geo';
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
  t.anisotropicFilteringLevel = 4;
  return t;
}
export function streetMaterials(scene: Scene) {
  const facades = ['brick', 'stone', 'modern'].map((style, index) => {
    const size = 128,
      diffuse = new Uint8Array(size * size * 4),
      emission = new Uint8Array(diffuse.length);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const px = x % 64,
          py = y % 64,
          window =
            index === 2
              ? px > 7 && px < 57 && py > 12 && py < 54
              : px > 15 && px < 48 && py > 18 && py < 51;
        const frame = window && (px % 16 < 2 || py === 34),
          mortar =
            index === 0 &&
            (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 12) % 24 === 0);
        const cornice = index === 1 && (py < 4 || py > 59),
          noise = seeded(x + y * size) * 0.08;
        const wall = mortar ? 0.62 : cornice ? 1 : 0.86 + noise;
        const rgb = window
          ? frame
            ? [0.42, 0.48, 0.48]
            : [0.12, 0.21, 0.27]
          : [wall, wall, wall];
        const lit =
            window &&
            !frame &&
            (Math.floor(x / 64) + Math.floor(y / 64) * 2 + index) % 3 !== 0,
          base = (y * size + x) * 4;
        for (let c = 0; c < 3; c++) {
          diffuse[base + c] = rgb[c] * 255;
          emission[base + c] = lit ? [220, 169, 92][c] : 0;
        }
        diffuse[base + 3] = emission[base + 3] = 255;
      }
    const mat = new StandardMaterial('facade-' + style, scene);
    mat.diffuseTexture = texture(scene, style + '-windows', diffuse, size);
    mat.emissiveTexture = texture(scene, style + '-night', emission, size);
    for (const t of [mat.diffuseTexture, mat.emissiveTexture] as RawTexture[])
      t.uScale = t.vScale = 0.5;
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    mat.maxSimultaneousLights = 8;
    mat.specularColor = new Color3(0.08, 0.09, 0.1);
    return mat;
  });
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
  return { facades, sidewalks };
}
