import {
  SpotLight,
  ShadowGenerator,
  Vector3,
  Color3,
  type AbstractMesh,
  type Scene,
} from '@babylonjs/core';
import type { CarVisual } from './visuals';
import type { Settings } from './types';

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
  constructor(private scene: Scene) {
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
      light.range = 55;
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
    this.clock -= dt;
    const refresh = this.clock <= 0;
    if (refresh) this.clock = 0.2;
    this.pool.forEach((entry, i) => {
      const car = i === 0 ? player : nearest[i - 1],
        active = !!car && (i === 0 || daylight < 0.65),
        changed = entry.owner !== car;
      entry.owner = car;
      entry.light.setEnabled(active);
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
      entry.light.intensity = i === 0 ? 12 : 8;
      if (refresh || changed)
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
  }
}
