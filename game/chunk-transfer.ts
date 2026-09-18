import type { ChunkData, MeshData } from './types';

const float32 = (values: number[]) => new Float32Array(values);
const uint32 = (values: number[]) => new Uint32Array(values);

function normals(positions: ArrayLike<number>, indices: ArrayLike<number>) {
  const result = new Float32Array(positions.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ai = indices[i] * 3,
      bi = indices[i + 1] * 3,
      ci = indices[i + 2] * 3,
      abx = positions[bi] - positions[ai],
      aby = positions[bi + 1] - positions[ai + 1],
      abz = positions[bi + 2] - positions[ai + 2],
      acx = positions[ci] - positions[ai],
      acy = positions[ci + 1] - positions[ai + 1],
      acz = positions[ci + 2] - positions[ai + 2],
      nx = aby * acz - abz * acy,
      ny = abz * acx - abx * acz,
      nz = abx * acy - aby * acx;
    for (const vertex of [ai, bi, ci]) {
      result[vertex] += nx;
      result[vertex + 1] += ny;
      result[vertex + 2] += nz;
    }
  }
  for (let i = 0; i < result.length; i += 3) {
    const length = Math.hypot(result[i], result[i + 1], result[i + 2]) || 1;
    result[i] /= length;
    result[i + 1] /= length;
    result[i + 2] /= length;
  }
  return result;
}

function prepareMesh(mesh: MeshData, transfer: ArrayBuffer[]): MeshData {
  if (!mesh.positions.length || !mesh.indices.length) return { ...mesh };
  const positions = float32(mesh.positions),
    indices = uint32(mesh.indices),
    preparedNormals = mesh.normals?.length
      ? float32(mesh.normals)
      : normals(positions, indices),
    colors = mesh.colors?.length ? float32(mesh.colors) : undefined,
    uvs = mesh.uvs?.length ? float32(mesh.uvs) : undefined;
  transfer.push(positions.buffer, indices.buffer, preparedNormals.buffer);
  if (colors) transfer.push(colors.buffer);
  if (uvs) transfer.push(uvs.buffer);
  return {
    positions: positions as unknown as number[],
    indices: indices as unknown as number[],
    normals: preparedNormals as unknown as number[],
    colors: colors as unknown as number[] | undefined,
    uvs: uvs as unknown as number[] | undefined,
  };
}

export function prepareChunkTransfer(chunk: ChunkData) {
  const transfer: ArrayBuffer[] = [],
    mesh = (value: MeshData | undefined) =>
      value ? prepareMesh(value, transfer) : undefined,
    list = (value: MeshData[] | undefined) =>
      value?.map((entry) => prepareMesh(entry, transfer));
  return {
    chunk: {
      ...chunk,
      terrain: prepareMesh(chunk.terrain, transfer),
      road: prepareMesh(chunk.road, transfer),
      shoulders: prepareMesh(chunk.shoulders, transfer),
      sidewalks: mesh(chunk.sidewalks),
      paved: mesh(chunk.paved),
      landmarks: mesh(chunk.landmarks),
      facades: list(chunk.facades),
      bareFacades: list(chunk.bareFacades),
      markings: prepareMesh(chunk.markings, transfer),
      structures: prepareMesh(chunk.structures, transfer),
      treeTrunks: prepareMesh(chunk.treeTrunks, transfer),
      buildings: prepareMesh(chunk.buildings, transfer),
      windows: prepareMesh(chunk.windows, transfer),
      water: prepareMesh(chunk.water, transfer),
    },
    transfer,
  };
}
