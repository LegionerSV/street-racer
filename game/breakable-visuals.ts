import {
  Mesh,
  MeshBuilder,
  VertexBuffer,
  VertexData,
  type Scene,
} from '@babylonjs/core';

function inclineFence(mesh: Mesh, length: number, rise: number): Mesh {
  if (rise && length > 0) {
    const positions = mesh.getVerticesData(VertexBuffer.PositionKind)!;
    for (let i = 0; i < positions.length; i += 3)
      positions[i + 1] += (positions[i + 2] * rise) / length;
    mesh.setVerticesData(VertexBuffer.PositionKind, positions);
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, mesh.getIndices()!, normals);
    mesh.setVerticesData(VertexBuffer.NormalKind, normals);
    mesh.refreshBoundingInfo();
  }
  return mesh;
}

export function createFenceVisual(
  scene: Scene,
  type: 'park' | 'embankment' | undefined,
  length: number,
  rise = 0,
) {
  if (type !== 'park') {
    const parts: Mesh[] = [];
    for (const [name, width, height, y] of [
      ['embankment-parapet-base', 0.6, 0.16, 0.08],
      ['embankment-parapet-body', 0.46, 0.68, 0.5],
      ['embankment-parapet-cap', 0.6, 0.16, 0.92],
    ] as const) {
      const part = MeshBuilder.CreateBox(
        name,
        { width, height, depth: length },
        scene,
      );
      part.position.y = y;
      parts.push(part);
    }
    const mesh = Mesh.MergeMeshes(parts, true, true, undefined, false, true)!;
    mesh.name = 'embankment-parapet';
    return inclineFence(mesh, length, rise);
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
  return inclineFence(mesh, length, rise);
}
