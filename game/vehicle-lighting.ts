import {
  SpotLight,
  ShadowGenerator,
  Vector3,
  Color3,
  Constants,
  RawTexture,
  Texture,
  Mesh,
  StandardMaterial,
  VertexData,
  type AbstractMesh,
  type Scene,
} from '@babylonjs/core';
import type { CarVisual } from './visuals';
import type { Settings } from './types';
import type { SurfaceContact } from './surface-contact';

export function headlightPattern(size: number) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size,
        v = (y + 0.5) / size;
      const cutoff =
        u < 0.52 ? 0.37 : 0.37 + 0.18 * Math.min(1, (u - 0.52) / 0.08);
      const edge = Math.max(0, Math.min(1, (cutoff - v + 0.012) / 0.024));
      const spread = Math.max(0, 1 - Math.pow(Math.abs(u - 0.5) / 0.52, 4));
      const reach = Math.max(0, 1 - Math.pow(Math.max(0, v - 0.83) / 0.17, 2));
      const brightness = Math.round(255 * edge * spread * reach);
      const i = (y * size + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = brightness;
      pixels[i + 3] = brightness;
    }
  return pixels;
}

export function headlightCasters(
  scene: Scene,
  position: Vector3,
  car: CarVisual,
  range: number,
) {
  return scene.meshes.filter((m) => {
    if (!m.isVisible || !m.isEnabled() || m.isDescendantOf(car.root))
      return false;
    if (
      !(
        m.metadata?.vehicle ||
        /:structures$|:buildings$|:facade[0-2]$|:landmarks$/.test(m.name)
      )
    )
      return false;
    if (/light|window|indicator/.test(m.name)) return false;
    const b = m.getBoundingInfo().boundingBox,
      min = b.minimumWorld,
      max = b.maximumWorld;
    return (
      Math.hypot(
        Math.max(min.x - position.x, 0, position.x - max.x),
        Math.max(min.y - position.y, 0, position.y - max.y),
        Math.max(min.z - position.z, 0, position.z - max.z),
      ) < range
    );
  });
}
// Один общий луч на пару фар; ещё два источника переиспользуются ближайшим трафиком.
// Карты глубины нужны и на мобильном профиле: иначе фары освещают сквозь кузова.
export class VehicleLighting {
  private pool: {
    light: SpotLight;
    shadow: ShadowGenerator;
    owner?: CarVisual;
  }[] = [];
  private clock = 0;
  private quality = '';
  private pattern: RawTexture;
  private roadBeam: Mesh;
  private roadBeamMaterial: StandardMaterial;
  constructor(
    private scene: Scene,
    private surface?: (
      x: number,
      z: number,
      referenceY: number,
    ) => SurfaceContact,
  ) {
    const size = 128;
    this.pattern = new RawTexture(
      headlightPattern(size),
      size,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      false,
      true,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    this.pattern.gammaSpace = false;
    this.pattern.wrapU = this.pattern.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.roadBeam = new Mesh('vehicle-headlight-road-cutoff', scene);
    this.roadBeam.isPickable = false;
    this.roadBeam.receiveShadows = false;
    const rows = 9,
      positions = Array.from({ length: rows * 2 * 3 }, () => 0),
      indices: number[] = [],
      uvs: number[] = [];
    for (let row = 0; row < rows; row++) {
      uvs.push(0, row / (rows - 1), 1, row / (rows - 1));
      if (row < rows - 1) {
        const base = row * 2;
        indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
      }
    }
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.uvs = uvs;
    data.applyToMesh(this.roadBeam, true);
    this.roadBeamMaterial = new StandardMaterial(
      'vehicle-headlight-road-cutoff-material',
      scene,
    );
    this.roadBeamMaterial.diffuseColor = Color3.Black();
    this.roadBeamMaterial.emissiveColor = new Color3(0.76, 0.88, 1);
    this.roadBeamMaterial.emissiveTexture = this.pattern;
    this.roadBeamMaterial.opacityTexture = this.pattern;
    this.roadBeamMaterial.disableLighting = true;
    this.roadBeamMaterial.backFaceCulling = false;
    this.roadBeamMaterial.zOffset = -3;
    this.roadBeam.material = this.roadBeamMaterial;
    this.roadBeam.setEnabled(false);
    for (let i = 0; i < 3; i++) {
      const light = new SpotLight(
        'vehicle-beam-' + i,
        Vector3.Zero(),
        new Vector3(0, -0.07, 1),
        0.75,
        2,
        scene,
      );
      light.diffuse = new Color3(0.76, 0.88, 1);
      light.specular = Color3.Black();
      light.range = 55;
      light.projectionTexture = this.pattern;
      light.intensity = 0;
      light.renderPriority = 10 - i;
      const shadow = new ShadowGenerator(i === 0 ? 512 : 256, light);
      shadow.bias = 0.002;
      shadow.normalBias = 0.03;
      shadow.darkness = 0;
      this.pool.push({ light, shadow });
    }
  }
  update(
    dt: number,
    player: CarVisual,
    traffic: CarVisual[],
    quality: Settings['quality'],
    daylight: number,
  ) {
    if (this.quality !== quality) {
      this.quality = quality;
      this.pool.forEach(
        (p, i) =>
          (p.shadow.mapSize =
            quality === 'mobile' ? (i === 0 ? 256 : 128) : i === 0 ? 512 : 256),
      );
    }
    const nearest = traffic
      .filter(
        (car) =>
          Vector3.DistanceSquared(car.root.position, player.root.position) <
          55 * 55,
      )
      .sort(
        (a, b) =>
          Vector3.DistanceSquared(a.root.position, player.root.position) -
          Vector3.DistanceSquared(b.root.position, player.root.position),
      )
      .slice(0, quality === 'mobile' ? 1 : 2);
    const beamActive = player.root.isEnabled();
    this.roadBeam.setEnabled(beamActive);
    if (beamActive) {
      const rawForward = player.root.getDirection(Vector3.Forward()),
        center = player.root.position,
        vertices: number[] = [];
      for (let row = 0; row < 9; row++) {
        const distance = 3 + row * 6.25,
          forward = rawForward.normalize(),
          right = new Vector3(forward.z, 0, -forward.x).normalize(),
          half = 1.25 + distance * 0.16;
        for (const side of [-1, 1]) {
          const p = center
              .add(forward.scale(distance))
              .add(right.scale(half * side)),
            contact = this.surface?.(p.x, p.z, center.y);
          vertices.push(p.x, (contact?.height ?? center.y - 0.83) + 0.028, p.z);
        }
      }
      this.roadBeam.updateVerticesData('position', vertices);
      this.roadBeam.refreshBoundingInfo();
      this.roadBeamMaterial.alpha =
        0.55 * (1 - Math.max(0, Math.min(1, daylight)) * 0.65);
    }
    this.clock -= dt;
    const refresh = this.clock <= 0;
    if (refresh) this.clock = 0.2;
    this.pool.forEach((entry, i) => {
      const car = i === 0 ? player : nearest[i - 1],
        active = !!car && daylight < (i === 0 ? 0.85 : 0.65),
        changed = entry.owner !== car;
      entry.owner = car;
      entry.light.setEnabled(active);
      // При достаточном дневном свете луч остаётся видимым, но три карты
      // глубины добавляют теневые проходы для тысяч мешей почти без эффекта.
      entry.light.shadowEnabled = active && daylight < 0.25;
      if (!car || !active) {
        entry.light.parent = null;
        entry.shadow.getShadowMap()!.renderList = [];
        return;
      }
      const headlights = car.lamps.filter((m) => m.name.includes('headlight'));
      // Источник принадлежит пулу: выгрузка машины не должна уничтожить его.
      entry.light.position.set(
        0,
        headlights[0]?.position.y ?? 0.1,
        Math.max(...headlights.map((m) => m.position.z), 2.1) + 0.08,
      );
      const world = car.root.computeWorldMatrix(true);
      Vector3.TransformCoordinatesToRef(
        entry.light.position,
        world,
        entry.light.position,
      );
      Vector3.TransformNormalToRef(
        new Vector3(0, -0.07, 1),
        world,
        entry.light.direction,
      );
      entry.light.direction.normalize();
      entry.light.intensity =
        (i === 0 ? 2.4 : 1.6) * (1 - Math.max(0, Math.min(1, daylight)));
      if (!entry.light.shadowEnabled)
        entry.shadow.getShadowMap()!.renderList = [];
      else if (refresh || changed)
        entry.shadow.getShadowMap()!.renderList = headlightCasters(
          this.scene,
          car.root.position,
          car,
          60,
        ) as AbstractMesh[];
    });
  }
  dispose() {
    for (const p of this.pool) {
      p.shadow.dispose();
      p.light.dispose();
    }
    this.roadBeam.dispose();
    this.roadBeamMaterial.dispose();
    this.pattern.dispose();
  }
}
