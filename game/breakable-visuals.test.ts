import { NullEngine, Scene, VertexBuffer } from '@babylonjs/core';
import { expect, it } from 'vitest';
import { createFenceVisual } from './breakable-visuals';

it.each(
  [-3, 0, 3].flatMap((rise) =>
    ['park', 'embankment'].map((type) => ({
      rise,
      type: type as 'park' | 'embankment',
    })),
  ),
)('сохраняет постоянную высоту ограды на уклоне: %j', ({ rise, type }) => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    // Act
    const mesh = createFenceVisual(scene, type, 10, rise);
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    const localHeights = Array.from(
      { length: positions.length / 3 },
      (_, i) => positions[i * 3 + 1] - (positions[i * 3 + 2] * rise) / 10,
    );
    // Assert
    expect(Math.min(...localHeights)).toBeCloseTo(0, 5);
    expect(Math.max(...localHeights)).toBeCloseTo(type === 'park' ? 2 : 1, 5);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('делает парковую решётку двухметровой и гранитный парапет набережной метровым', () => {
  // Arrange
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    // Act
    const park = createFenceVisual(scene, 'park', 8);
    const embankment = createFenceVisual(scene, 'embankment', 8);
    park.refreshBoundingInfo();
    embankment.refreshBoundingInfo();
    // Assert
    expect(park.getBoundingInfo().boundingBox.extendSize.y * 2).toBeCloseTo(
      2,
      2,
    );
    expect(
      embankment.getBoundingInfo().boundingBox.extendSize.y * 2,
    ).toBeCloseTo(1, 2);
    expect(
      embankment.getBoundingInfo().boundingBox.extendSize.x * 2,
    ).toBeCloseTo(0.6, 2);
    expect(park.getBoundingInfo().boundingBox.minimum.y).toBeCloseTo(0, 2);
    expect(embankment.getBoundingInfo().boundingBox.minimum.y).toBeCloseTo(
      0,
      2,
    );
    expect(park.getTotalVertices()).toBeGreaterThan(
      embankment.getTotalVertices(),
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
