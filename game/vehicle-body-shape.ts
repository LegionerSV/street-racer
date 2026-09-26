export type Contour = [number, number][];
export type VehicleBodyShape = {
  form: 'saloon' | 'liftback' | 'hatch' | 'van' | 'cab';
  shellRear: number;
  roof: Contour;
  belt: Contour;
  windows: Contour[];
  frontGlass: [number, number];
  rearGlass?: [number, number];
  roofWidth: number;
  corners: [number, number];
  sill: [number, number];
  headlamp: Contour;
  taillamp: Contour;
  grille: Contour;
  lowerGrille: Contour;
  sideHeadlamp: Contour;
  sideTaillamp: Contour;
  frontDetails: { material: 'alloy' | 'front'; outline: Contour }[];
  rim: [number, number, boolean];
  cladding: number;
  rail: boolean;
  cargo?: 'flatbed' | 'box';
  sculpt?: 'x';
};

export function contourHeight(points: Contour, x: number) {
  if (x <= points[0][0]) return points[0][1];
  if (x >= points.at(-1)![0]) return points.at(-1)![1];
  const i = points.findIndex((p, j) => j > 0 && p[0] >= x) - 1;
  const a = points[i],
    b = points[i + 1],
    span = b[0] - a[0],
    t = (x - a[0]) / span;
  const slope = (j: number) =>
    (points[j + 1][1] - points[j][1]) / (points[j + 1][0] - points[j][0]);
  const tangent = (j: number) => {
    if (j === 0) return slope(0);
    if (j === points.length - 1) return slope(j - 1);
    const left = slope(j - 1),
      right = slope(j);
    return left * right <= 0 ? 0 : (2 * left * right) / (left + right);
  };
  return (
    (2 * t * t * t - 3 * t * t + 1) * a[1] +
    (t * t * t - 2 * t * t + t) * span * tangent(i) +
    (-2 * t * t * t + 3 * t * t) * b[1] +
    (t * t * t - t * t) * span * tangent(i + 1)
  );
}
