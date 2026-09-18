import { NullEngine, Scene } from '@babylonjs/core';
import { expect, it } from 'vitest';
import { createFenceVisual } from './breakable-visuals';

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
