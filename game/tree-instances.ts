import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { seeded } from './geo';
import type { Point } from './types';

function matrixAt(
  position: Vector3,
  scale: Vector3,
  rotation = Quaternion.Identity(),
) {
  return Matrix.Compose(scale, rotation, position).m;
}

export function treeInstances(trees: Point[]) {
  const trunks = new Float32Array(trees.length * 16),
    branches = new Float32Array(trees.length * 3 * 16),
    leaves = new Float32Array(trees.length * 5 * 16);
  trees.forEach((tree, i) => {
    const seed = Math.floor(tree.x * 17 + tree.z * 31);
    const crownHeight = 7.6 + seeded(seed + 1) * 1.5;
    trunks.set(
      matrixAt(
        new Vector3(tree.x, tree.y + 3.5, tree.z),
        new Vector3(
          0.8 + seeded(seed + 2) * 0.5,
          1,
          0.8 + seeded(seed + 2) * 0.5,
        ),
      ),
      i * 16,
    );
    const centralScale = new Vector3(
      0.62 + seeded(seed + 3) * 0.12,
      0.64 + seeded(seed + 4) * 0.16,
      0.62,
    );
    leaves.set(
      matrixAt(new Vector3(tree.x, tree.y + crownHeight, tree.z), centralScale),
      i * 5 * 16,
    );
    for (let j = 0; j < 3; j++) {
      const angle = (j * Math.PI * 2) / 3 + seeded(seed + j * 11) * 0.75;
      const radius = 2.8 + seeded(seed + j * 19 + 5) * 1.25;
      const dx = Math.cos(angle),
        dz = Math.sin(angle);
      const branchDirection = new Vector3(dx * 0.7, 1, dz * 0.7).normalize();
      const axis = Vector3.Cross(Vector3.Up(), branchDirection).normalize();
      const rotation = Quaternion.RotationAxis(
        axis,
        Math.acos(Vector3.Dot(Vector3.Up(), branchDirection)),
      );
      branches.set(
        matrixAt(
          new Vector3(
            tree.x + dx * radius * 0.58,
            tree.y + 4.55 + j * 0.28,
            tree.z + dz * radius * 0.58,
          ),
          new Vector3(0.95, 1.3 + j * 0.12, 0.95),
          rotation,
        ),
        (i * 3 + j) * 16,
      );
      const leafScale = new Vector3(
        0.58 + seeded(seed + j * 13 + 6) * 0.2,
        0.55 + seeded(seed + j * 13 + 7) * 0.2,
        0.62 + seeded(seed + j * 13 + 8) * 0.2,
      );
      leaves.set(
        matrixAt(
          new Vector3(
            tree.x + dx * radius,
            tree.y + crownHeight - 0.8 + seeded(seed + j * 7) * 1.6,
            tree.z + dz * radius,
          ),
          leafScale,
        ),
        (i * 5 + j + 1) * 16,
      );
    }
    // Пятый объём висит ниже остальных; между ним и верхушкой остаются просветы.
    const angle = seeded(seed + 99) * Math.PI * 2;
    leaves.set(
      matrixAt(
        new Vector3(
          tree.x + Math.cos(angle) * 1.5,
          tree.y + crownHeight - 2.2,
          tree.z + Math.sin(angle) * 1.5,
        ),
        new Vector3(0.6, 0.55, 0.75),
      ),
      (i * 5 + 4) * 16,
    );
  });
  return { trunks, branches, leaves };
}
