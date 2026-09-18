import { Matrix, Mesh, MeshBuilder, type Scene } from '@babylonjs/core';

export function createFenceVisual(
  scene: Scene,
  type: 'park' | 'embankment' | undefined,
  length: number,
) {
  if (type !== 'park') {
    const mesh = MeshBuilder.CreateBox(
      'embankment-fence',
      { width: 0.14, height: 1.05, depth: length },
      scene,
    );
    mesh.bakeTransformIntoVertices(Matrix.Translation(0, 0.525, 0));
    return mesh;
  }
  const parts: Mesh[] = [];
  for (const y of [0.62, 1.42]) {
    const rail = MeshBuilder.CreateBox(
      'park-fence-rail',
      { width: 0.12, height: 0.1, depth: length },
      scene,
    );
    rail.position.y = y;
    parts.push(rail);
  }
  const intervals = Math.max(1, Math.ceil(length / 0.72));
  for (let index = 0; index <= intervals; index++) {
    const z = -length / 2 + (length * index) / intervals;
    const bar = MeshBuilder.CreateBox(
      'park-fence-bar',
      { width: 0.1, height: 1.82, depth: 0.1 },
      scene,
    );
    bar.position.set(0, 0.91, z);
    parts.push(bar);
    const finial = MeshBuilder.CreateCylinder(
      'park-fence-finial',
      {
        height: 0.18,
        diameterTop: 0,
        diameterBottom: 0.14,
        tessellation: 4,
      },
      scene,
    );
    finial.position.set(0, 1.91, z);
    parts.push(finial);
  }
  const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
  mesh.name = 'park-fence';
  return mesh;
}
