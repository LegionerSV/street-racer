import { seeded } from './geo';
import type { Point } from './types';

export type Tree = Point & { id?: number; height?: number };
export function treeDimensions(tree: Tree) {
  const seed = tree.id ?? Math.floor(tree.x * 17 + tree.z * 31);
  const age = seeded(seed + 317);
  const generated =
    age < 0.18
      ? 5 + (age / 0.18) * 3
      : age < 0.88
        ? 9 + ((age - 0.18) / 0.7) * 6
        : 18 + ((age - 0.88) / 0.12) * 7;
  const height =
    Number.isFinite(tree.height) && tree.height! >= 2 && tree.height! <= 45
      ? tree.height!
      : generated;
  return {
    seed,
    height,
    vertical: height / 11.5,
    horizontal:
      Math.pow(height / 11.5, 0.65) * (0.85 + seeded(seed + 91) * 0.3),
  };
}
