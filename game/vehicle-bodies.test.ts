import { expect, it } from 'vitest';
import {
  NullEngine,
  Scene,
  VertexBuffer,
  Ray,
  Vector3,
  Mesh,
} from '@babylonjs/core';
import { VEHICLE_BODIES } from './vehicle-bodies';
import { VEHICLE_PROFILES } from './vehicle-profiles';
import { createCar } from './visuals';
import { contourHeight } from './vehicle-body-shape';

it.each(Object.keys(VEHICLE_BODIES) as (keyof typeof VEHICLE_BODIES)[])(
  'под ветровым стеклом %s нет закрашивающей его поверхности кузова',
  (id) => {
    // Arrange
    const engine = new NullEngine(),
      scene = new Scene(engine);
    const profile = VEHICLE_PROFILES[id],
      body = VEHICLE_BODIES[id];
    const car = createCar(scene, '#8899aa', 'window', profile.kind, false, id);
    const z = (body.frontGlass[0] + body.frontGlass[1]) / 2;
    const windowY = contourHeight(body.roof, z) - profile.rideHeight;
    try {
      // Act
      const ray = new Ray(
        new Vector3(0, windowY + 0.2, z * profile.length),
        new Vector3(0, -1, 0),
      );
      const paint = car.root
        .getChildMeshes()
        .find((m) => m.material?.name.endsWith('-paint')) as Mesh;
      paint.computeWorldMatrix(true);
      const hit = paint.intersects(ray, false);
      // Assert
      expect(!hit.hit || hit.pickedPoint!.y < windowY - 0.08).toBe(true);
    } finally {
      car.dispose();
      scene.dispose();
      engine.dispose();
    }
  },
);

it('у каждой модели собственные массивы геометрии, включая окна и оптику', () => {
  // Arrange
  const seen = new Set<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    expect(seen.has(value)).toBe(false);
    seen.add(value);
    for (const child of Object.values(value)) visit(child);
  };
  // Act / Assert
  expect(Object.keys(VEHICLE_BODIES).sort()).toEqual(
    Object.keys(VEHICLE_PROFILES).sort(),
  );
  for (const body of Object.values(VEHICLE_BODIES)) visit(body);
});

it('пятая дверь кроссоверов доходит до кормы, у кабин нет седанного кузова под платформой', () => {
  // Arrange / Act
  const bodies = Object.values(VEHICLE_BODIES);
  // Assert
  for (const body of bodies.filter(
    (b) => b.form === 'hatch' || b.form === 'van',
  )) {
    expect(body.roof[0][0]).toBe(body.shellRear);
  }
  for (const body of bodies.filter((b) => b.form === 'cab')) {
    expect(body.shellRear).toBeGreaterThan(0);
    expect(body.cargo).toBeDefined();
  }
  expect(VEHICLE_BODIES['small-truck'].cargo).toBe('flatbed');
  expect(VEHICLE_BODIES['box-truck'].cargo).toBe('box');
});

it('локальная правка крыши Rio не меняет геометрию ГАЗели', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const vertices = () => {
    const car = createCar(
      scene,
      '#ffffff',
      'isolation',
      'truck',
      false,
      'small-truck',
    );
    const result = car.root
      .getChildMeshes()
      .map((m) => Array.from(m.getVerticesData(VertexBuffer.PositionKind)!));
    car.dispose();
    return result;
  };
  const before = vertices(),
    roof = VEHICLE_BODIES['city-sedan'].roof[2],
    original = roof[1];
  try {
    // Act
    roof[1] += 0.15;
    const after = vertices();
    // Assert
    expect(after).toEqual(before);
  } finally {
    roof[1] = original;
    scene.dispose();
    engine.dispose();
  }
});
