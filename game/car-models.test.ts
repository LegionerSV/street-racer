import { expect, it } from 'vitest';
import {
  NullEngine,
  Scene,
  VertexBuffer,
  Vector3,
  Ray,
  Mesh,
  PBRMaterial,
} from '@babylonjs/core';
import { createCar, createTrafficCar, type CarKind } from './visuals';
import { VEHICLE_PROFILES, type VehicleModelId } from './vehicle-profiles';
it('цвет лака переводится из sRGB в линейное пространство PBR без потери оттенка', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  // Act
  const car = createCar(scene, '#e94b18', 'colour');
  // Assert
  try {
    const paint = car.materials.find((m) =>
      m.name.endsWith('-paint'),
    ) as PBRMaterial;
    expect(
      paint.albedoColor.toGammaSpace(true).toHexString().toLowerCase(),
    ).toBe('#e94b18');
  } finally {
    car.dispose();
    scene.dispose();
    engine.dispose();
  }
});
it.each(['sport', 'sedan', 'hatch', 'suv', 'van'] as CarKind[])(
  'кузов %s закрыт снаружи, фары расположены перед ним',
  (kind) => {
    // Arrange
    const engine = new NullEngine(),
      scene = new Scene(engine),
      car = createCar(scene, '#447788', kind, kind);
    try {
      // Act — луч снаружи отбирает только лицевые стороны: тот же отсев, что при отрисовке.
      const paint = car.root
        .getChildMeshes()
        .find(
          (m) =>
            m.name.includes('trim-') && m.material?.name.endsWith('-paint'),
        )! as Mesh;
      paint.computeWorldMatrix(true);
      const frontFace = (a: Vector3, b: Vector3, c: Vector3, ray: Ray) =>
        Vector3.Dot(
          Vector3.Cross(a.subtract(b), c.subtract(b)),
          ray.direction,
        ) < 0;
      const front = new Ray(new Vector3(0, -0.1, 8), new Vector3(0, 0, -1));
      const rear = new Ray(new Vector3(0, -0.1, -8), new Vector3(0, 0, 1));
      const top = new Ray(new Vector3(0, 4, -0.3), new Vector3(0, -1, 0));
      const left = new Ray(new Vector3(-4, -0.1, 0), new Vector3(1, 0, 0));
      const right = new Ray(new Vector3(4, -0.1, 0), new Vector3(-1, 0, 0));
      // Assert
      for (const ray of [front, rear, top, left, right])
        expect(paint.intersects(ray, false, frontFace).hit).toBe(true);
      expect(
        paint.intersects(front, false, frontFace).pickedPoint!.z,
      ).toBeGreaterThan(1.8);
      expect(
        paint.intersects(rear, false, frontFace).pickedPoint!.z,
      ).toBeLessThan(-1.8);
      expect(
        paint.intersects(left, false, frontFace).pickedPoint!.x,
      ).toBeLessThan(-0.7);
      expect(
        paint.intersects(right, false, frontFace).pickedPoint!.x,
      ).toBeGreaterThan(0.7);
      expect(
        paint.intersects(top, false, frontFace).pickedPoint!.y,
      ).toBeGreaterThan(car.profile.height - car.profile.rideHeight - 0.04);
      expect(paint.material!.needAlphaBlendingForMesh(paint)).toBe(false);
      expect(paint.material!.disableDepthWrite).toBe(false);
      expect(
        paint.getVerticesData(VertexBuffer.NormalKind)!.every(Number.isFinite),
      ).toBe(true);
      for (const lamp of car.lamps.filter(
        (m) => m.name.includes('headlight') && !m.name.includes('wrap'),
      )) {
        lamp.computeWorldMatrix(true);
        const pos = lamp.getAbsolutePosition();
        const hit = paint.intersects(
          new Ray(new Vector3(pos.x, pos.y, 8), new Vector3(0, 0, -1)),
          false,
        );
        expect(hit.hit && hit.pickedPoint!.z > pos.z).toBe(false);
      }
    } finally {
      car.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
);

it.each(Object.keys(VEHICLE_PROFILES) as VehicleModelId[])(
  'модель %s имеет настоящие арки, ограниченную геометрию и шины на земле',
  (model) => {
    // Arrange
    const engine = new NullEngine(),
      scene = new Scene(engine),
      profile = VEHICLE_PROFILES[model];
    const car = createCar(scene, '#447788', model, profile.kind, false, model);
    try {
      // Act
      const paint = car.root
        .getChildMeshes()
        .find((m) => m.material?.name.endsWith('-paint'))! as Mesh;
      paint.computeWorldMatrix(true);
      const triangleCount = car.root
        .getChildMeshes()
        .reduce((sum, m) => sum + m.getTotalIndices() / 3, 0);
      // Assert
      expect(triangleCount).toBeLessThan(14000);
      for (const wheel of car.wheels) {
        expect(
          wheel.position.y - profile.wheelRadius + profile.rideHeight,
        ).toBeCloseTo(0, 6);
        const ray = new Ray(
          new Vector3(-5, wheel.position.y, wheel.position.z),
          Vector3.Right(),
        );
        expect(paint.intersects(ray, false).hit).toBe(false);
      }
    } finally {
      car.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
);

it('состаренный лак отличается от обычного, стекло и резина не становятся металлом', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const normal = createCar(scene, '#447788', 'normal'),
    aged = createCar(
      scene,
      '#447788',
      'aged',
      'sport',
      false,
      'sport-coupe',
      'aged',
    );
  try {
    // Act
    const get = (car: typeof normal, role: string) =>
      car.materials.find((m) => m.name.endsWith(role)) as PBRMaterial;
    // Assert
    expect(get(aged, 'paint').roughness).toBeGreaterThan(
      get(normal, 'paint').roughness!,
    );
    expect(get(aged, 'paint').clearCoat.intensity).toBeLessThan(
      get(normal, 'paint').clearCoat.intensity,
    );
    expect(get(normal, 'rubber').metallic).toBe(0);
    expect(get(normal, 'rubber').roughness).toBeGreaterThan(0.8);
    expect(get(normal, 'glass').metallic).toBe(0);
    expect(get(normal, 'alloy').metallic).toBeGreaterThan(0.8);
  } finally {
    normal.dispose();
    aged.dispose();
    scene.dispose();
    engine.dispose();
  }
});
it('пять типов кузова имеют разные пропорции и реальные размеры в метрах', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine),
    kinds: CarKind[] = ['sport', 'sedan', 'hatch', 'suv', 'van'];
  const cars = kinds.map((kind) => createCar(scene, '#447788', kind, kind));
  try {
    // Act
    const sizes = cars.map((car) => {
      const b = car.root.getHierarchyBoundingVectors(true);
      return b.max.subtract(b.min);
    });
    // Assert
    expect(new Set(sizes.map((s) => s.y.toFixed(2)))).toHaveLength(5);
    for (const s of sizes) {
      expect(s.x).toBeGreaterThan(1.7);
      expect(s.x).toBeLessThan(2.5);
      expect(s.z).toBeGreaterThan(3.7);
      expect(s.z).toBeLessThan(5.4);
    }
    expect(sizes[0].y).toBeLessThan(sizes[1].y);
    expect(sizes[2].z).toBeLessThan(sizes[1].z);
    expect(sizes[4].y).toBeGreaterThan(sizes[3].y);
  } finally {
    cars.forEach((c) => c.dispose());
    scene.dispose();
    engine.dispose();
  }
});
it('разные кузова одного цвета не подменяются общим прототипом, одинаковые используют его повторно', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const sedan = createTrafficCar(scene, '#447788', 'sedan', 'sedan'),
    van = createTrafficCar(scene, '#447788', 'van', 'van');
  const count = scene.materials.length;
  // Act
  const another = createTrafficCar(scene, '#447788', 'van-2', 'van');
  // Assert
  try {
    expect(scene.materials.length).toBe(count);
    expect(van.root.getHierarchyBoundingVectors(true).max.y).toBeGreaterThan(
      sedan.root.getHierarchyBoundingVectors(true).max.y + 0.4,
    );
    expect(another.wheels).toHaveLength(4);
  } finally {
    sedan.dispose();
    van.dispose();
    another.dispose();
    scene.dispose();
    engine.dispose();
  }
});
it('гоночный кузов получает номерные наклейки на обе двери', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  // Act
  const racer = createCar(scene, '#447788', 'racer', 'sport', true),
    ordinary = createCar(scene, '#447788', 'ordinary', 'sport');
  // Assert
  try {
    const trim = (car: typeof racer) =>
      car.root
        .getChildMeshes()
        .find(
          (m) =>
            m.name.includes('trim-') && m.material?.name.endsWith('-alloy'),
        )!;
    expect(
      trim(racer).getVerticesData(VertexBuffer.PositionKind)!.length,
    ).toBeGreaterThan(
      trim(ordinary).getVerticesData(VertexBuffer.PositionKind)!.length,
    );
  } finally {
    racer.dispose();
    ordinary.dispose();
    scene.dispose();
    engine.dispose();
  }
});
it('разные цвета используют общую геометрию, удаление экземпляра не ломает остальные', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const first = createTrafficCar(scene, '#447788', 'first', 'sedan');
  const count = scene.geometries.length;
  // Act
  const second = createTrafficCar(scene, '#bb4433', 'second', 'sedan');
  first.dispose();
  // Assert
  try {
    expect(scene.geometries.length).toBe(count);
    expect(
      second.root.getChildMeshes().every((mesh) => mesh.getTotalVertices() > 0),
    ).toBe(true);
    const third = createTrafficCar(scene, '#447788', 'third', 'sedan');
    expect(third.wheels).toHaveLength(4);
    expect(scene.geometries.length).toBe(count);
    third.dispose();
  } finally {
    second.dispose();
    scene.dispose();
    engine.dispose();
  }
});
