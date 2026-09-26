import { Constants, RawCubeTexture, Scene, Texture } from '@babylonjs/core';

export function environmentFaces(
  size: number,
  daylight: number,
  clouds: number,
) {
  const day = Math.max(0, Math.min(1, daylight)),
    cloud = Math.max(0, Math.min(1, clouds));
  return Array.from({ length: 6 }, (_, face) => {
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = ((x + 0.5) / size) * 2 - 1,
          v = ((y + 0.5) / size) * 2 - 1;
        const d =
          face === 0
            ? [1, -v, -u]
            : face === 1
              ? [-1, -v, u]
              : face === 2
                ? [u, 1, v]
                : face === 3
                  ? [u, -1, -v]
                  : face === 4
                    ? [u, -v, 1]
                    : [-u, -v, -1];
        const h = d[1] / Math.hypot(...d),
          az = Math.atan2(d[2], d[0]);
        const skyline =
          0.08 +
          0.09 * (0.5 + 0.5 * Math.sin(az * 9)) +
          0.055 * (0.5 + 0.5 * Math.cos(az * 17));
        const building = h > -0.08 && h < skyline,
          ground = h < -0.08;
        const sky = [
          0.3 + cloud * 0.12,
          0.44 + cloud * 0.02,
          0.62 - cloud * 0.12,
        ];
        const horizon = Math.pow(1 - Math.max(0, h), 4);
        const reflection = ground
          ? [0.065, 0.067, 0.064]
          : building
            ? [0.13, 0.145, 0.15]
            : sky.map((c) => c + (1 - c) * horizon * 0.3);
        const facade = building ? 0.7 + 0.3 * Math.cos(az * 32) : 1;
        for (let c = 0; c < 3; c++)
          pixels[(y * size + x) * 4 + c] = Math.round(
            255 * Math.min(1, reflection[c] * facade * (0.025 + day * 0.975)),
          );
        pixels[(y * size + x) * 4 + 3] = 255;
      }
    return pixels;
  });
}
const environments = new WeakMap<
  Scene,
  { texture: RawCubeTexture; key: string }
>();
export function makeEnvironment(scene: Scene) {
  const texture = new RawCubeTexture(
    scene,
    environmentFaces(64, 1, 0.25),
    64,
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  texture.name = 'procedural-city-reflections';
  texture.coordinatesMode = Texture.CUBIC_MODE;
  texture.gammaSpace = false;
  scene.environmentTexture = texture;
  scene.environmentIntensity = 0.8;
  environments.set(scene, { texture, key: '20:5' });
  return texture;
}
export function updateVehicleEnvironment(
  scene: Scene,
  daylight: number,
  clouds: number,
) {
  const env = environments.get(scene);
  if (!env) return;
  const day = Math.round(daylight * 20),
    cloud = Math.round(clouds * 20),
    key = day + ':' + cloud;
  if (env.key === key) return;
  env.texture.update(
    environmentFaces(64, day / 20, cloud / 20),
    Constants.TEXTUREFORMAT_RGBA,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
    false,
  );
  env.texture.forceSphericalPolynomialsRecompute();
  env.key = key;
}
