import { expect, it } from 'vitest';
import { ActionManager, MeshBuilder, NullEngine, Scene, FreeCamera, Vector3, Matrix } from '@babylonjs/core';
import { skipHiddenRenderCandidates } from './render-candidates';

it('исключает скрытые коллайдеры, сохраняя источники instances и обработчики пересечений', () => {
  // Arrange
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const collider = MeshBuilder.CreateBox('collider', {}, scene);
  const source = MeshBuilder.CreateBox('source', {}, scene);
  const trigger = MeshBuilder.CreateBox('trigger', {}, scene);
  collider.isVisible = source.isVisible = trigger.isVisible = false;
  trigger.actionManager = new ActionManager(scene);
  const instance = source.createInstance('car');
  const original = scene.getActiveMeshCandidates;
  const restore = skipHiddenRenderCandidates(scene);
  const candidates = () => {
    const result = scene.getActiveMeshCandidates();
    return result.data.slice(0, result.length);
  };
  try {
    // Act / Assert
    expect(candidates()).toEqual([source, trigger, instance]);
    collider.isVisible = true;
    expect(candidates()).toContain(collider);
    collider.isVisible = false;
    instance.dispose();
    expect(candidates()).toEqual([trigger]);
    restore();
    expect(scene.getActiveMeshCandidates).toBe(original);
    expect(candidates()).toContain(collider);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

it('обновляет видимого потомка скрытого родителя и сохраняет thin instances', () => {
  // Arrange
  const engine = new NullEngine(), scene = new Scene(engine);
  const camera = new FreeCamera('camera', new Vector3(0, 0, -10), scene);
  camera.setTarget(Vector3.Zero());
  const parent = MeshBuilder.CreateBox('parent', {}, scene);
  parent.isVisible = false;
  const child = MeshBuilder.CreateBox('child', {}, scene);
  child.parent = parent;
  const thin = MeshBuilder.CreateBox('thin', {}, scene);
  thin.isVisible = false;
  thin.thinInstanceSetBuffer('matrix', new Float32Array(Matrix.Identity().asArray()), 16);
  skipHiddenRenderCandidates(scene);
  try {
    // Act
    scene.render();
    parent.position.x = 3;
    scene.render();
    // Assert
    expect(child.getAbsolutePosition().x).toBe(3);
    expect(scene.getActiveMeshes().data.slice(0, scene.getActiveMeshes().length)).toContain(child);
    const candidates = scene.getActiveMeshCandidates();
    expect(candidates.data.slice(0, candidates.length)).toContain(thin);
  } finally { scene.dispose(); engine.dispose(); }
});
