import { seeded } from './geo';

export const ASPHALT_COLOUR: [number, number, number] = [0.34, 0.35, 0.36];

export function graniteSurface(size: number) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const crystal = seeded(Math.floor(x / 2) + Math.floor(y / 2) * size);
      const grain = seeded(i * 19);
      const shade = Math.round(175 + crystal * 42 + grain * 24);
      pixels[i * 4] = shade;
      pixels[i * 4 + 1] = shade - 3;
      pixels[i * 4 + 2] = shade - 7;
      pixels[i * 4 + 3] = 255;
    }
  return pixels;
}

export function normalMap(
  height: Float32Array,
  size: number,
  strength: number,
) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (xx: number, yy: number) =>
        height[((yy + size) % size) * size + ((xx + size) % size)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const length = Math.hypot(dx, dy, 1),
        offset = (y * size + x) * 4;
      pixels[offset] = Math.round(127.5 * (1 - dx / length));
      pixels[offset + 1] = Math.round(127.5 * (1 - dy / length));
      pixels[offset + 2] = Math.round(127.5 * (1 + 1 / length));
      pixels[offset + 3] = 255;
    }
  return pixels;
}

export function facadeSurface(
  style: 'brick' | 'stone' | 'modern' | 'wood',
  size: number,
  windows = true,
) {
  const diffuse = new Uint8Array(size * size * 4);
  const emission = new Uint8Array(diffuse.length);
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const px = x % 64,
        py = y % 64;
      const window =
        windows &&
        (style === 'modern'
          ? px > 7 && px < 57 && py > 12 && py < 54
          : style === 'wood'
            ? px > 19 && px < 44 && py > 21 && py < 50
            : px > 15 && px < 48 && py > 18 && py < 51);
      const frame =
        window &&
        (style === 'wood' ? px === 31 || py === 34 : px % 16 < 2 || py === 34);
      const mortar =
        style === 'brick' &&
        (y % 8 === 0 || (x + (Math.floor(y / 8) % 2) * 12) % 24 === 0);
      const stoneJoint = style === 'stone' && (y % 8 === 0 || x % 48 === 0);
      const panelJoint = style === 'modern' && (x % 24 === 0 || y % 16 === 0);
      const boardJoint = style === 'wood' && y % 8 === 0;
      const cornice = style === 'stone' && (py < 4 || py > 59);
      const grain =
        (style === 'wood'
          ? seeded(Math.floor(x / 3) + y * size)
          : seeded(x + y * size)) - 0.5;
      const brickTone =
        seeded(Math.floor(x / 12) + Math.floor(y / 8) * 17) - 0.5;
      const stoneTone =
        seeded(Math.floor(x / 48) + Math.floor(y / 8) * 29) - 0.5;
      const shade =
        style === 'brick'
          ? mortar
            ? 128
            : Math.round(216 + brickTone * 42 + grain * 12)
          : style === 'stone'
            ? cornice
              ? 240
              : stoneJoint
                ? 188
                : Math.round(220 + stoneTone * 22 + grain * 18)
            : style === 'wood'
              ? boardJoint
                ? 116
                : Math.round(
                    205 +
                      (seeded(Math.floor(y / 8) * 37) - 0.5) * 28 +
                      grain * 16,
                  )
              : panelJoint
                ? 171
                : Math.round(231 + grain * 14);
      const base = (y * size + x) * 4;
      height[y * size + x] = window
        ? frame
          ? 0.6
          : 0.08
        : mortar || stoneJoint || panelJoint || boardJoint
          ? 0.23
          : cornice
            ? 0.95
            : 0.75 + grain * 0.12;
      const rgb = window
        ? frame
          ? [107, 122, 122]
          : [31, 54, 69]
        : [shade, shade, shade];
      const lit =
        window &&
        !frame &&
        (Math.floor(x / 64) +
          Math.floor(y / 64) * 2 +
          ['brick', 'stone', 'modern', 'wood'].indexOf(style)) %
          3 !==
          0;
      for (let c = 0; c < 3; c++) {
        diffuse[base + c] = rgb[c];
        emission[base + c] = lit ? [220, 169, 92][c] : 0;
      }
      diffuse[base + 3] = emission[base + 3] = 255;
    }
  return { diffuse, emission, normal: normalMap(height, size, 1.2) };
}

export function asphaltSurface(size: number) {
  const colour = new Uint8Array(size * size * 4),
    specular = new Uint8Array(colour.length);
  const height = new Float32Array(size * size);
  const patches = Float32Array.from({ length: 64 }, (_, index) =>
    seeded(index * 71),
  );
  const patchAt = (x: number, y: number) =>
    patches[((y + 8) % 8) * 8 + ((x + 8) % 8)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const index = y * size + x,
        offset = index * 4;
      const grain = seeded(index * 19),
        gx = (x * 8) / size,
        gy = (y * 8) / size;
      const ix = Math.floor(gx),
        iy = Math.floor(gy),
        tx = gx - ix,
        ty = gy - iy;
      const smoothX = tx * tx * (3 - 2 * tx),
        smoothY = ty * ty * (3 - 2 * ty);
      const patch =
        (patchAt(ix, iy) * (1 - smoothX) + patchAt(ix + 1, iy) * smoothX) *
          (1 - smoothY) +
        (patchAt(ix, iy + 1) * (1 - smoothX) +
          patchAt(ix + 1, iy + 1) * smoothX) *
          smoothY;
      const shade = Math.round(170 + grain * 55 + patch * 30);
      colour[offset] = colour[offset + 1] = colour[offset + 2] = shade;
      colour[offset + 3] = 255;
      height[index] = grain * 0.6 + patch * 0.3;
      const sheen = Math.round(2 + (1 - grain) * 6 + patch * 12);
      specular[offset] = specular[offset + 1] = specular[offset + 2] = sheen;
      specular[offset + 3] = 255;
    }
  return { colour, normal: normalMap(height, size, 0.45), specular };
}
