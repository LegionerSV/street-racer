import earcut from 'earcut';
import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Matrix,
  VertexData,
  Vector3,
  Scene,
  Material,
  AbstractMesh,
  PBRMaterial,
} from '@babylonjs/core';
import {
  DEFAULT_MODELS,
  VEHICLE_PROFILES,
  type CarKind,
  type PaintFinish,
  type VehicleModelId,
} from './vehicle-profiles';
import type { CarVisual } from './visuals';
import { VEHICLE_BODIES } from './vehicle-bodies';
import { contourHeight, type Contour } from './vehicle-body-shape';

export function createCar(
  scene: Scene,
  color: string,
  name: string,
  kind: CarKind = 'sport',
  racing = false,
  model: VehicleModelId = DEFAULT_MODELS[kind],
  finish: PaintFinish = 'standard',
): CarVisual {
  const shape = VEHICLE_BODIES[model];
  const p = VEHICLE_PROFILES[model],
    sport = p.kind === 'sport',
    truck = p.kind === 'truck',
    van = p.kind === 'van';
  const half = p.length / 2,
    width = p.width / 2;
  const base = -p.rideHeight + shape.sill[0],
    shellRear = shape.shellRear * p.length;
  const roof = Math.max(...shape.roof.map((k) => k[1])) - p.rideHeight;
  const beltAt = (z: number) =>
    contourHeight(shape.belt, z / p.length) - p.rideHeight;
  const belt = beltAt(0);
  const root = MeshBuilder.CreateBox(
    name,
    { width: p.width, height: sport ? 0.55 : p.height - 0.28, depth: p.length },
    scene,
  );
  if (!sport)
    root.bakeTransformIntoVertices(
      Matrix.Translation(0, (p.height - 0.28) / 2 + base, 0),
    );
  root.isVisible = false;
  root.isPickable = false;
  root.metadata = { carKind: p.kind, vehicleModel: model, paintFinish: finish };
  const aged = finish === 'aged';
  const paint = new PBRMaterial(name + '-paint', scene);
  paint.albedoColor = Color3.FromHexString(color).toLinearSpace(true);
  if (aged)
    paint.albedoColor = Color3.Lerp(
      paint.albedoColor,
      new Color3(0.32, 0.3, 0.27).toLinearSpace(true),
      0.16,
    );
  paint.metallic = aged ? 0.08 : 0.28;
  paint.roughness = aged ? 0.67 : 0.34;
  paint.clearCoat.isEnabled = true;
  paint.clearCoat.intensity = aged ? 0.18 : 0.78;
  paint.clearCoat.roughness = aged ? 0.48 : 0.19;
  const glass = new PBRMaterial(name + '-glass', scene);
  glass.albedoColor = new Color3(0.045, 0.065, 0.075);
  glass.metallic = 0;
  glass.roughness = 0.13;
  glass.indexOfRefraction = 1.52;
  const lens = new PBRMaterial(name + '-lens', scene);
  lens.albedoColor = new Color3(0.19, 0.23, 0.26);
  lens.metallic = 0;
  lens.roughness = 0.12;
  const dark = new PBRMaterial(name + '-rubber', scene);
  dark.albedoColor = new Color3(0.025, 0.03, 0.035);
  dark.metallic = 0;
  dark.roughness = 0.9;
  const alloy = new PBRMaterial(name + '-alloy', scene);
  alloy.albedoColor = new Color3(0.72, 0.74, 0.76);
  alloy.environmentIntensity = 1.5;
  alloy.metallic = 0.9;
  alloy.roughness = aged ? 0.5 : 0.3;
  const cargo = new PBRMaterial(name + '-cargo', scene);
  cargo.albedoColor = new Color3(0.63, 0.65, 0.62);
  cargo.metallic = 0.04;
  cargo.roughness = 0.76;
  const lampMaterial = (id: string, c: string, emission: number) => {
    const m = new StandardMaterial(name + '-' + id, scene);
    m.diffuseColor = Color3.FromHexString(c);
    m.emissiveColor = m.diffuseColor.scale(emission);
    m.specularColor.setAll(0.25);
    return m;
  };
  const rear = lampMaterial('rear', '#8b1716', 0.22),
    front = lampMaterial('front', '#e6edf0', 0.5),
    brake = lampMaterial('brake', '#fa3629', 1),
    amber = lampMaterial('indicator', '#ffac32', 1);
  const materials: Material[] = [
    paint,
    glass,
    lens,
    dark,
    alloy,
    cargo,
    rear,
    front,
    brake,
    amber,
  ];
  for (const mat of materials) {
    mat.transparencyMode = Material.MATERIAL_OPAQUE;
    mat.alpha = 1;
    mat.disableDepthWrite = false;
    (mat as PBRMaterial).maxSimultaneousLights = 8;
  }
  glass.alpha = 0.72;
  glass.transparencyMode = Material.MATERIAL_ALPHABLEND;
  const box = (
    id: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    mat: Material,
  ) => {
    const m = MeshBuilder.CreateBox(
      name + '-' + id,
      { width: w, height: h, depth: d },
      scene,
    );
    m.parent = root;
    m.position.set(x, y, z);
    m.material = mat;
    m.isPickable = false;
    return m;
  };
  const surface = (
    id: string,
    positions: number[],
    indices: number[],
    mat: Material,
  ) => {
    const m = new Mesh(name + '-' + id, scene),
      v = new VertexData(),
      normals: number[] = [];
    v.positions = positions;
    v.indices = indices;
    VertexData.ComputeNormals(positions, indices, normals);
    v.normals = normals;
    v.uvs = Array.from({ length: (positions.length / 3) * 2 }, () => 0);
    v.applyToMesh(m);
    m.parent = root;
    m.material = mat;
    m.isPickable = false;
    return m;
  };
  const panel = (
    id: string,
    points: number[][],
    mat: Material,
    normal: Vector3,
  ) => {
    const a = Vector3.FromArray(points[0]),
      b = Vector3.FromArray(points[1]),
      c = Vector3.FromArray(points[2]);
    const reverse =
        Vector3.Dot(Vector3.Cross(b.subtract(a), c.subtract(a)), normal) > 0,
      indices: number[] = [];
    for (let i = 1; i < points.length - 1; i++)
      indices.push(...(reverse ? [0, i + 1, i] : [0, i, i + 1]));
    return surface(id, points.flat(), indices, mat);
  };
  const patch = (
    id: string,
    columns: number,
    rows: number,
    point: (u: number, v: number) => number[],
    mat: Material,
    normal: Vector3,
  ) => {
    const positions: number[] = [],
      indices: number[] = [];
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++)
        positions.push(...point(i / columns, j / rows));
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < columns; i++) {
        const a = j * (columns + 1) + i;
        for (const triangle of [
          [a, a + 1, a + columns + 2],
          [a, a + columns + 2, a + columns + 1],
        ]) {
          const [pa, pb, pc] = triangle.map((k) =>
            Vector3.FromArray(positions, k * 3),
          );
          if (
            Vector3.Dot(
              Vector3.Cross(pb.subtract(pa), pc.subtract(pa)),
              normal,
            ) > 0
          )
            triangle.reverse();
          indices.push(...triangle);
        }
      }
    return surface(id, positions, indices, mat);
  };
  const wheelY = -p.rideHeight + p.wheelRadius,
    axles = [p.wheelbase / 2, -p.wheelbase / 2];
  const arch = p.wheelRadius + 0.04;
  const zs = Array.from(
    { length: 41 },
    (_, i) => shellRear + ((half - shellRear) * i) / 40,
  );
  zs.push(
    shellRear + 0.025,
    shellRear + 0.07,
    shellRear + 0.14,
    half - 0.14,
    half - 0.07,
    half - 0.025,
  );
  for (const axle of axles.filter((z) => z >= shellRear)) {
    zs.push(axle - arch - 0.008, axle + arch + 0.008);
    for (let j = 0; j <= 16; j++)
      zs.push(axle + Math.cos((j * Math.PI) / 16) * arch);
  }
  for (let i = zs.length - 1; i >= 0; i--)
    if (zs[i] < shellRear || zs[i] > half) zs.splice(i, 1);
  zs.sort((a, b) => a - b);
  const bodyWidth = (z: number) => {
    const corner =
      z < (shellRear + half) / 2 ? shape.corners[0] : shape.corners[1];
    const fromEnd = Math.min(z - shellRear, half - z);
    return (
      width -
      (fromEnd < corner
        ? corner -
          Math.sqrt(Math.max(0, corner * corner - (corner - fromEnd) ** 2))
        : 0) -
      0.016 * Math.cos(((z / half) * Math.PI) / 2)
    );
  };
  const shoulder = (z: number) => beltAt(z);
  const sideWidth = (z: number, y: number) => {
    const t = Math.max(0, Math.min(1, (y - base) / (shoulder(z) - base)));
    return (
      bodyWidth(z) -
      0.045 * (1 - t) ** 3 -
      0.075 * t ** 4 +
      0.018 * Math.sin(Math.PI * t) -
      (shape.sculpt === 'x' ? 0.043 : 0.014) *
        Math.exp(
          -(
            ((t -
              (shape.sculpt === 'x' ? 0.5 + 0.22 * Math.abs(z / half) : 0.42) -
              (0.05 * z) / half) /
              0.13) **
            2
          ),
        )
    );
  };
  const bottom = (z: number) =>
    Math.max(
      base +
        (shape.sill[1] - shape.sill[0]) *
          Math.pow(
            Math.abs((z - (shellRear + half) / 2) / ((half - shellRear) / 2)),
            8,
          ),
      ...axles.map((a) =>
        Math.abs(z - a) <= arch
          ? wheelY + Math.sqrt(Math.max(0, arch * arch - (z - a) ** 2))
          : base,
      ),
    );
  for (const side of [-1, 1]) {
    const vertices: number[] = [],
      indices: number[] = [];
    const bands = 7;
    for (const z of zs) {
      const top = shoulder(z),
        low = bottom(z);
      for (let j = 0; j <= bands; j++) {
        const y = low + ((top - low) * j) / bands;
        vertices.push(side * sideWidth(z, y), y, z);
      }
    }
    for (let i = 0; i < zs.length - 1; i++)
      for (let j = 0; j < bands; j++) {
        const a = i * (bands + 1) + j,
          b = a + bands + 1;
        indices.push(
          ...(side === 1
            ? [a, b, b + 1, a, b + 1, a + 1]
            : [a, b + 1, b, a, a + 1, b + 1]),
        );
      }
    const trimPositions: number[] = [],
      trimIndices: number[] = [];
    for (const z of zs) {
      const low = bottom(z),
        high = Math.max(low, base + shape.cladding);
      for (const y of [low, high])
        trimPositions.push(side * (sideWidth(z, y) + 0.005), y, z);
    }
    for (let i = 0; i < zs.length - 1; i++) {
      const a = i * 2;
      trimIndices.push(
        ...(side === 1
          ? [a, a + 2, a + 3, a, a + 3, a + 1]
          : [a, a + 3, a + 2, a, a + 1, a + 3]),
      );
    }
    surface('lower-cladding', trimPositions, trimIndices, dark);
    const sideMesh = surface('body-side', vertices, indices, paint);
    const normals: number[] = [];
    for (let i = 0; i < vertices.length; i += 3) {
      const y = vertices[i + 1],
        z = vertices[i + 2],
        step = 0.001;
      const dy = (sideWidth(z, y + step) - sideWidth(z, y - step)) / (2 * step);
      const dz =
        (sideWidth(Math.min(half, z + step), y) -
          sideWidth(Math.max(-half, z - step), y)) /
        (Math.min(half, z + step) - Math.max(-half, z - step));
      const n = new Vector3(side, -dy, -dz).normalize();
      normals.push(n.x, n.y, n.z);
    }
    sideMesh.setVerticesData('normal', normals);
    for (const axle of axles.filter((z) => z >= shellRear)) {
      panel(
        'wheel-well-back',
        Array.from({ length: 24 }, (_, i) => {
          const a = (i * Math.PI) / 12;
          return [
            side * (p.track / 2 - 0.15),
            wheelY + Math.sin(a) * (arch + 0.025),
            axle + Math.cos(a) * (arch + 0.025),
          ];
        }),
        dark,
        new Vector3(side, 0, 0),
      );
      patch(
        'wheel-well',
        16,
        1,
        (u, v) => {
          const a = u * Math.PI,
            r = arch + 0.025;
          return [
            side * (p.track / 2 - 0.15 + v * (width - p.track / 2 + 0.15)),
            wheelY + Math.sin(a) * r,
            axle + Math.cos(a) * r,
          ];
        },
        dark,
        Vector3.Down(),
      );
      const vertices: number[] = [],
        indices: number[] = [];
      for (let j = 0; j <= 16; j++) {
        const angle = (j * Math.PI) / 16;
        for (const r of [arch, arch + 0.022]) {
          const z = axle + Math.cos(angle) * r,
            y = wheelY + Math.sin(angle) * r;
          vertices.push(side * (sideWidth(z, y) + 0.004), y, z);
        }
      }
      for (let j = 0; j < 16; j++) {
        const a = j * 2;
        indices.push(
          ...(side === 1
            ? [a, a + 2, a + 3, a, a + 3, a + 1]
            : [a, a + 3, a + 2, a, a + 1, a + 3]),
        );
      }
      surface(
        'wheel-arch',
        vertices,
        indices.flatMap((_, i) =>
          i % 3 === 0 ? [indices[i], indices[i + 2], indices[i + 1]] : [],
        ),
        p.kind === 'suv' || truck || aged ? dark : paint,
      );
    }
  }
  // Плечи и капот имеют непрерывные нормали, арки остаются настоящими вырезами.
  const deck: number[] = [],
    deckIndices: number[] = [];
  for (const z of zs)
    for (let i = 0; i <= 12; i++) {
      const t = i / 6 - 1;
      deck.push(
        t * (bodyWidth(z) - 0.075),
        shoulder(z) + (1 - t * t) * 0.07,
        z,
      );
    }
  for (let j = 0; j < zs.length - 1; j++)
    for (let i = 0; i < 12; i++) {
      const a = j * 13 + i;
      deckIndices.push(a, a + 1, a + 14, a, a + 14, a + 13);
    }
  surface('hood-and-deck', deck, deckIndices, paint);
  for (const end of [-1, 1]) {
    const z = end > 0 ? half : shellRear,
      w = bodyWidth(z),
      top = shoulder(z);
    patch(
      'bumper',
      16,
      8,
      (u, v) => {
        const t = u * 2 - 1,
          bulge = Math.sin(Math.PI * v);
        return [
          t * (w - 0.045 * (1 - v) ** 3 - 0.075 * v ** 4),
          base + (top - base) * v + (1 - t * t) * 0.07 * v,
          z + end * 0.05 * (1 - t * t) * bulge,
        ];
      },
      paint,
      new Vector3(0, 0, end),
    );
    if (truck && end < 0) continue;
    box(
      'bumper-insert',
      0,
      base + 0.06,
      z + end * 0.057,
      p.width * 0.78,
      0.095,
      0.035,
      dark,
    );
    const plateY =
      end < 0 && shape.form === 'hatch' ? beltAt(z) - 0.22 : base + 0.25;
    box(
      'number-plate-recess',
      0,
      plateY,
      z + end * 0.06,
      0.54,
      0.14,
      0.025,
      dark,
    );
    box(
      'blank-number-plate',
      0,
      plateY,
      z + end * 0.078,
      0.46,
      0.105,
      0.012,
      alloy,
    );
  }
  box('underbody', 0, base + 0.035, 0, p.track - 0.3, 0.07, p.wheelbase, dark);

  const frontSeatZ =
    shape.form === 'cab' ? p.length * (shape.roof[2][0] + 0.035) : 0.05;
  for (const z of truck || van ? [frontSeatZ] : [frontSeatZ, frontSeatZ - 0.82])
    for (const side of [-1, 1]) {
      const seat = box(
        'seat-back',
        side * 0.36,
        (truck ? 1.48 : 0.94) - p.rideHeight,
        z,
        0.43,
        0.51,
        0.12,
        dark,
      );
      seat.rotation.x = -0.1;
      box(
        'seat-headrest',
        side * 0.36,
        (truck ? 1.79 : 1.24) - p.rideHeight,
        z - 0.025,
        0.23,
        0.16,
        0.13,
        dark,
      );
    }
  box(
    'dashboard',
    0,
    beltAt(shape.roof.at(-1)![0] * p.length) - 0.02,
    shape.roof.at(-1)![0] * p.length - 0.19,
    p.width * 0.73,
    0.12,
    0.3,
    dark,
  );
  const cr = shape.roof[0][0] * p.length,
    cf = shape.roof.at(-1)![0] * p.length;
  const rr = shape.roof[2][0] * p.length,
    rf = shape.roof.at(-2)![0] * p.length;
  const roofWidth = width * shape.roofWidth;
  const cabinWidthAt = (z: number) => bodyWidth(z) - 0.075;
  const cabinTop = (z: number) =>
    contourHeight(shape.roof, z / p.length) - p.rideHeight;
  const cabinSection = (z: number) => {
    const height = cabinTop(z),
      rise = Math.max(
        0,
        Math.min(1, (height - beltAt(z)) / Math.max(0.01, roof - beltAt(z))),
      );
    const cabinWidth = cabinWidthAt(z);
    return {
      height,
      rise,
      topWidth: cabinWidth + (roofWidth - cabinWidth) * rise,
    };
  };
  const topPoint = (u: number, z: number, offset = 0) => {
    const t = u * 2 - 1,
      c = cabinSection(z);
    return [
      t * c.topWidth,
      c.height + 0.035 * (1 - t * t) * c.rise + offset,
      z,
    ];
  };
  const glassSpans = [
    shape.frontGlass,
    ...(shape.rearGlass ? [shape.rearGlass] : []),
  ].map((pair) => pair.map((z) => z * p.length));
  const roofCuts = [cr, cf, ...glassSpans.flat()].sort((a, b) => a - b);
  for (let i = 0; i < roofCuts.length - 1; i++) {
    const start = roofCuts[i],
      end = roofCuts[i + 1],
      mid = (start + end) / 2;
    const glazing = glassSpans.some((pair) => mid > pair[0] && mid < pair[1]);
    for (const [left, right] of glazing
      ? [
          [0, 0.08],
          [0.92, 1],
        ]
      : [[0, 1]]) {
      patch(
        'cabin-top',
        glazing ? 2 : 14,
        Math.max(2, Math.ceil((end - start) * 14)),
        (u, v) =>
          topPoint(left + (right - left) * u, start + (end - start) * v),
        paint,
        Vector3.Up(),
      );
    }
  }
  const topGlass = (id: string, start: number, end: number) =>
    patch(
      id,
      14,
      12,
      (u, v) => {
        const z = start + (end - start) * v;
        return topPoint(0.08 + u * 0.84, z, 0.009);
      },
      glass,
      Vector3.Up(),
    );
  topGlass(
    'windscreen',
    shape.frontGlass[0] * p.length,
    shape.frontGlass[1] * p.length,
  );
  if (shape.rearGlass)
    topGlass(
      'rear-window',
      shape.rearGlass[0] * p.length,
      shape.rearGlass[1] * p.length,
    );
  for (const side of [-1, 1]) {
    const sidePoint = (z: number, v: number, offset = 0) => {
      const c = cabinSection(z),
        x =
          cabinWidthAt(z) +
          (c.topWidth - cabinWidthAt(z)) * v +
          0.018 * Math.sin(Math.PI * v);
      return [side * (x + offset), beltAt(z) + (c.height - beltAt(z)) * v, z];
    };
    const sideOutline: number[] = [];
    for (let j = 0; j <= 48; j++) {
      const z = cr + ((cf - cr) * j) / 48;
      sideOutline.push(z, beltAt(z));
    }
    for (let j = 48; j >= 0; j--) {
      const z = cr + ((cf - cr) * j) / 48;
      sideOutline.push(z, cabinTop(z));
    }
    const windowHoles: number[] = [];
    const windowPoint = (z: number, y: number, offset: number) => {
      const height = y - p.rideHeight,
        v = (height - beltAt(z)) / Math.max(0.01, cabinTop(z) - beltAt(z));
      return sidePoint(z, Math.min(0.985, Math.max(0.015, v)), offset);
    };
    for (const window of shape.windows) {
      const center = window.reduce(
        (sum, k) => [
          sum[0] + k[0] / window.length,
          sum[1] + k[1] / window.length,
        ],
        [0, 0],
      );
      const outline: number[][] = [];
      for (let i = 0; i < window.length; i++) {
        const a = window[(i + window.length - 1) % window.length],
          b = window[i],
          c = window[(i + 1) % window.length];
        for (let j = 0; j <= 4; j++) {
          const t = j / 4,
            start = [b[0] + (a[0] - b[0]) * 0.08, b[1] + (a[1] - b[1]) * 0.08],
            end = [b[0] + (c[0] - b[0]) * 0.08, b[1] + (c[1] - b[1]) * 0.08];
          outline.push([
            (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * b[0] + t * t * end[0],
            (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * b[1] + t * t * end[1],
          ]);
        }
      }
      windowHoles.push(sideOutline.length / 2);
      for (const k of outline) {
        const pt = windowPoint(k[0] * p.length, k[1], 0);
        sideOutline.push(pt[2], pt[1]);
      }
      const positions = windowPoint(center[0] * p.length, center[1], 0.012),
        indices: number[] = [];
      for (const k of outline)
        positions.push(...windowPoint(k[0] * p.length, k[1], 0.012));
      for (let i = 0; i < outline.length; i++) {
        const tri = [0, i + 1, ((i + 1) % outline.length) + 1];
        const [a, b, c] = tri.map((k) => Vector3.FromArray(positions, k * 3));
        if (Vector3.Cross(b.subtract(a), c.subtract(a)).x * side > 0)
          tri.reverse();
        indices.push(...tri);
      }
      surface('side-window', positions, indices, glass);
    }
    const cabinIndices = earcut(sideOutline, windowHoles, 2),
      cabinPositions: number[] = [];
    for (let i = 0; i < sideOutline.length; i += 2) {
      const z = sideOutline[i],
        y = sideOutline[i + 1],
        v = (y - beltAt(z)) / Math.max(0.001, cabinTop(z) - beltAt(z));
      cabinPositions.push(...sidePoint(z, Math.max(0, Math.min(1, v))));
    }
    for (let i = 0; i < cabinIndices.length; i += 3) {
      const [a, b, c] = cabinIndices
        .slice(i, i + 3)
        .map((k) => Vector3.FromArray(cabinPositions, k * 3));
      if (Vector3.Cross(b.subtract(a), c.subtract(a)).x * side > 0)
        [cabinIndices[i + 1], cabinIndices[i + 2]] = [
          cabinIndices[i + 2],
          cabinIndices[i + 1],
        ];
    }
    surface('cabin-side', cabinPositions, cabinIndices, paint);
    if (shape.windows.length > 1) {
      const back = shape.windows.at(-2)!,
        front = shape.windows.at(-1)!;
      const bz = Math.max(...back.map((k) => k[0])),
        fz = Math.min(...front.map((k) => k[0]));
      if (fz - bz < 0.06) {
        patch(
          'b-pillar',
          2,
          8,
          (u, v) => {
            const z = (bz + (fz - bz) * u) * p.length;
            return sidePoint(z, 0.06 + v * 0.92, 0.017);
          },
          dark,
          new Vector3(side, 0, 0),
        );
      }
    }
    if (van)
      box(
        'sliding-door-track',
        side * (width + 0.006),
        belt - 0.11,
        -0.4,
        0.016,
        0.025,
        2,
        dark,
      );
    for (const z of shape.windows
      .slice(-(truck || van || sport ? 1 : 2))
      .map((w) => Math.min(...w.map((k) => k[0])) * p.length + 0.2)) {
      box(
        'door-handle',
        side * (bodyWidth(z) + 0.008),
        beltAt(z) - 0.07,
        z,
        0.025,
        0.029,
        0.15,
        aged ? dark : alloy,
      );
    }
    for (const seamZ of sport || truck || van
      ? [cf - 0.13]
      : [cf - 0.13, -0.12, cr + 0.45]) {
      patch(
        'door-seam',
        1,
        16,
        (u, v) => {
          const z = seamZ + (v < 0.2 ? 0.05 * (1 - v / 0.2) : 0),
            t = 0.12 + v * 0.8;
          const y = base + (shoulder(z) - base) * t;
          return [side * (sideWidth(z, y) + 0.003), y, z + (u - 0.5) * 0.008];
        },
        dark,
        new Vector3(side, 0, 0),
      );
    }
    if (!truck)
      box(
        'sill',
        side * (width - 0.05),
        base + 0.025,
        0,
        0.045,
        0.045,
        p.wheelbase - arch * 2,
        dark,
      );
    box(
      'mirror-stalk',
      side * (width + 0.015),
      beltAt(cf) + 0.09,
      cf - 0.16,
      0.12,
      0.032,
      0.06,
      dark,
    );
    const mirror = MeshBuilder.CreateSphere(
      name + '-mirror',
      { diameter: 1, segments: 8 },
      scene,
    );
    mirror.parent = root;
    mirror.position.set(side * (width + 0.065), beltAt(cf) + 0.12, cf - 0.18);
    mirror.scaling.set(0.2, 0.11, 0.24);
    mirror.material = aged ? dark : paint;
    box(
      'mirror-glass',
      side * (width + 0.065),
      beltAt(cf) + 0.12,
      cf - 0.297,
      0.13,
      0.064,
      0.008,
      glass,
    );
    if (shape.rail) {
      patch(
        'roof-rail',
        2,
        20,
        (u, v) => {
          const z = rr + 0.08 + (rf - rr - 0.16) * v;
          return [
            side * (roofWidth * 0.85 + (u - 0.5) * 0.035),
            cabinTop(z) + 0.07,
            z,
          ];
        },
        alloy,
        Vector3.Up(),
      );
    }
  }
  if (truck) {
    const cargoFront = shellRear - 0.1,
      cargoRear = -half + 0.05,
      cargoLength = cargoFront - cargoRear;
    const floor = 0.91 - p.rideHeight,
      top = (shape.cargo === 'flatbed' ? 1.34 : p.height) - p.rideHeight;
    for (const side of [-1, 1]) {
      box(
        'chassis-rail',
        side * 0.47,
        0.6 - p.rideHeight,
        -0.3,
        0.09,
        0.18,
        p.length - 0.65,
        dark,
      );
      box(
        'rear-mudguard',
        side * (p.track / 2),
        0.85 - p.rideHeight,
        -p.wheelbase / 2,
        0.3,
        0.06,
        1.02,
        dark,
      );
      box(
        'mud-flap',
        side * (p.track / 2),
        0.39 - p.rideHeight,
        -p.wheelbase / 2 - 0.5,
        0.3,
        0.45,
        0.025,
        dark,
      );
      box(
        'cargo-frame',
        side * (width - 0.02),
        floor,
        (cargoFront + cargoRear) / 2,
        0.055,
        0.12,
        cargoLength,
        alloy,
      );
      if (shape.cargo === 'flatbed') {
        box(
          'drop-side',
          side * (width - 0.02),
          (floor + top) / 2,
          (cargoFront + cargoRear) / 2,
          0.045,
          top - floor,
          cargoLength,
          cargo,
        );
        for (let z = cargoRear + 0.05; z < cargoFront; z += 0.65) {
          box(
            'side-latch',
            side * (width + 0.012),
            top - 0.08,
            z,
            0.03,
            0.12,
            0.04,
            alloy,
          );
        }
        for (let h = floor + 0.09; h < top; h += 0.09)
          box(
            'bed-rib',
            side * (width + 0.003),
            h,
            (cargoFront + cargoRear) / 2,
            0.01,
            0.01,
            cargoLength,
            alloy,
          );
      } else {
        box(
          'box-edge',
          side * width,
          (floor + top) / 2,
          cargoRear,
          0.04,
          top - floor,
          0.04,
          alloy,
        );
      }
    }
    if (shape.cargo === 'box') {
      box(
        'cargo-box',
        0,
        (top + floor) / 2,
        (cargoFront + cargoRear) / 2,
        p.width - 0.03,
        top - floor,
        cargoLength,
        cargo,
      );
      for (const x of [-width * 0.48, width * 0.48])
        box(
          'cargo-lock',
          x,
          (top + floor) / 2,
          cargoRear - 0.025,
          0.028,
          top - floor - 0.2,
          0.03,
          alloy,
        );
    } else {
      box(
        'bed-floor',
        0,
        floor,
        (cargoFront + cargoRear) / 2,
        p.width,
        0.09,
        cargoLength,
        cargo,
      );
      for (const z of [cargoFront, cargoRear])
        box(
          'drop-tail',
          0,
          (floor + top) / 2,
          z,
          p.width,
          top - floor,
          0.045,
          cargo,
        );
      for (const x of [-0.65, 0, 0.65])
        box(
          'bed-hinge',
          x,
          floor + 0.03,
          cargoRear - 0.04,
          0.12,
          0.04,
          0.035,
          alloy,
        );
    }
    box(
      'rear-underrun',
      0,
      0.36 - p.rideHeight,
      -half,
      0.9 * p.width,
      0.1,
      0.08,
      dark,
    );
    box('fuel-tank', -0.6, 0.6 - p.rideHeight, -0.3, 0.38, 0.35, 0.85, dark);
  }
  if (van) {
    for (const side of [-1, 1]) {
      for (const z of [-half + 0.08, -0.55, 0.48])
        box(
          'cargo-door-seam',
          side * (width - 0.07),
          1.54 - p.rideHeight,
          z,
          0.008,
          1.3,
          0.009,
          dark,
        );
      box(
        'cargo-side-moulding',
        side * (width + 0.004),
        0.58 - p.rideHeight,
        -0.28,
        0.025,
        0.12,
        p.length - 0.8,
        dark,
      );
      box(
        'sliding-handle',
        side * (width + 0.02),
        1.1 - p.rideHeight,
        0.32,
        0.03,
        0.055,
        0.18,
        dark,
      );
    }
    box(
      'rear-door-seam',
      0,
      1.38 - p.rideHeight,
      -half - 0.065,
      0.012,
      1.65,
      0.016,
      dark,
    );
  }
  if (sport) {
    box('rear-wing', 0, 0.47, -half + 0.28, 1.83, 0.06, 0.27, dark);
    for (const x of [-0.59, 0.59])
      box('wing-support', x, 0.34, -half + 0.28, 0.05, 0.24, 0.1, alloy);
    for (const x of [-0.25, 0.25])
      panel(
        'hood-stripe',
        [
          [x - 0.06, shoulder(cf) + 0.028, cf],
          [x + 0.06, shoulder(cf) + 0.028, cf],
          [x + 0.06, shoulder(half - 0.15) + 0.028, half - 0.15],
          [x - 0.06, shoulder(half - 0.15) + 0.028, half - 0.15],
        ],
        alloy,
        Vector3.Up(),
      );
    if (racing)
      for (const side of [-1, 1]) {
        box(
          'race-door-panel',
          side * (width + 0.01),
          belt - 0.16,
          -0.1,
          0.025,
          0.29,
          0.85,
          alloy,
        );
        for (const z of [-0.27, -0.1, 0.07])
          box(
            'race-door-number',
            side * (width + 0.025),
            belt - 0.16,
            z,
            0.012,
            0.22,
            0.045,
            dark,
          );
      }
  }
  const lamps: AbstractMesh[] = [],
    brakeLights: AbstractMesh[] = [],
    indicators: [AbstractMesh[], AbstractMesh[]] = [[], []];
  const frontY =
    shape.headlamp.reduce((sum, k) => sum + k[1] / shape.headlamp.length, 0) -
    p.rideHeight -
    0.06;
  const rearY =
    shape.taillamp.reduce((sum, k) => sum + k[1] / shape.taillamp.length, 0) -
    p.rideHeight -
    0.065;
  const facePoint = (x: number, y: number, end: number, offset = 0.015) => {
    const corner = shape.corners[end > 0 ? 1 : 0],
      xx = x * width,
      outer = Math.max(0, Math.abs(xx) - (width - corner));
    let z =
      half -
      corner +
      Math.sqrt(Math.max(0.001, corner * corner - outer * outer));
    if (end < 0 && !truck && y > shape.roof[0][1]) {
      const rear = shape.roof.slice(
        0,
        Math.max(
          3,
          shape.roof.findIndex(
            (k) => k[1] >= Math.max(...shape.roof.map((k) => k[1])) - 0.02,
          ) + 1,
        ),
      );
      const i = rear.findIndex((k, j) => j > 0 && k[1] >= y);
      if (i > 0) {
        const a = rear[i - 1],
          b = rear[i],
          t = (y - a[1]) / (b[1] - a[1]);
        z = -(a[0] + (b[0] - a[0]) * t) * p.length;
      }
    }
    const cap =
      end > 0
        ? shoulder(z) + 0.025
        : !truck && shape.form !== 'hatch' && shape.form !== 'van'
          ? shoulder(-z) + 0.025
          : Infinity;
    return [xx, Math.min(y - p.rideHeight, cap), end * (z + 0.055 + offset)];
  };
  const fittedPanel = (
    id: string,
    outline: Contour,
    point: (x: number, y: number) => number[],
    mat: Material,
    normal: Vector3,
  ) => {
    const triangles = earcut(outline.flat()),
      positions: number[] = [],
      indices: number[] = [];
    const add = (a: number[], b: number[], c: number[]) => {
      const av = Vector3.FromArray(a),
        bv = Vector3.FromArray(b),
        cv = Vector3.FromArray(c);
      const i = positions.length / 3;
      positions.push(...a, ...b, ...c);
      if (
        Vector3.Dot(Vector3.Cross(bv.subtract(av), cv.subtract(av)), normal) > 0
      )
        indices.push(i, i + 2, i + 1);
      else indices.push(i, i + 1, i + 2);
    };
    for (let i = 0; i < triangles.length; i += 3) {
      const a = outline[triangles[i]],
        b = outline[triangles[i + 1]],
        c = outline[triangles[i + 2]];
      const at = (u: number, v: number) =>
        point(
          a[0] + ((b[0] - a[0]) * u) / 3 + ((c[0] - a[0]) * v) / 3,
          a[1] + ((b[1] - a[1]) * u) / 3 + ((c[1] - a[1]) * v) / 3,
        );
      for (let u = 0; u < 3; u++)
        for (let v = 0; v < 3 - u; v++) {
          add(at(u, v), at(u + 1, v), at(u, v + 1));
          if (u + v < 2) add(at(u + 1, v), at(u + 1, v + 1), at(u, v + 1));
        }
    }
    return surface(id, positions, indices, mat);
  };
  const facePanel = (
    id: string,
    outline: Contour,
    mat: Material,
    end = 1,
    offset = 0.015,
  ) =>
    fittedPanel(
      id,
      outline,
      (x, y) => facePoint(x, y, end, offset),
      mat,
      new Vector3(0, 0, end),
    );
  facePanel('grille', shape.grille, dark);
  facePanel('lower-grille', shape.lowerGrille, dark);
  for (const detail of shape.frontDetails) {
    const mesh = facePanel(
      'front-detail',
      detail.outline,
      detail.material === 'alloy' ? alloy : front,
      1,
      0.031,
    );
    if (detail.material === 'front') lamps.push(mesh);
  }
  const gmin = Math.min(...shape.grille.map((k) => k[0])),
    gmax = Math.max(...shape.grille.map((k) => k[0]));
  const gymin = Math.min(...shape.grille.map((k) => k[1])),
    gymax = Math.max(...shape.grille.map((k) => k[1]));
  if (model === 'long-liftback') {
    for (let x = gmin + 0.035; x < gmax - 0.03; x += 0.065)
      facePanel(
        'vertical-grille-fin',
        [
          [x, gymin + 0.015],
          [x + 0.012, gymin + 0.015],
          [x + 0.012, gymax - 0.015],
          [x, gymax - 0.015],
        ],
        alloy,
        1,
        0.027,
      );
  } else {
    const rows = model === 'square-suv' || model === 'classic-sedan' ? 3 : 4;
    for (let j = 1; j <= rows; j++) {
      const y = gymin + ((gymax - gymin) * j) / (rows + 1),
        inset = model === 'metro-suv' ? 0.09 : 0.04;
      facePanel(
        'grille-fin',
        [
          [gmin + inset, y],
          [gmax - inset, y],
          [gmax - inset, y + 0.009],
          [gmin + inset, y + 0.009],
        ],
        aged ? dark : alloy,
        1,
        0.027,
      );
    }
  }
  for (const side of [-1, 1]) {
    const frontOutline = shape.headlamp.map(
      ([x, y]) => [x * side, y - 0.06] as [number, number],
    );
    const rearOutline = shape.taillamp.map(
      ([x, y]) => [x * side, y - 0.065] as [number, number],
    );
    lamps.push(facePanel('headlight-lens', frontOutline, lens, 1, 0.02));
    lamps.push(facePanel('taillight', rearOutline, rear, -1, 0.02));
    const center = rearOutline.reduce(
      (a, k) => [
        a[0] + k[0] / rearOutline.length,
        a[1] + k[1] / rearOutline.length,
      ],
      [0, 0],
    );
    brakeLights.push(
      facePanel(
        'brake-light',
        rearOutline.map(
          (k) =>
            [
              center[0] + (k[0] - center[0]) * 0.88,
              center[1] + (k[1] - center[1]) * 0.52,
            ] as [number, number],
        ),
        brake,
        -1,
        0.027,
      ),
    );
    const hx =
      side *
      shape.headlamp.reduce((sum, k) => sum + k[0] / shape.headlamp.length, 0);
    for (const dx of [-0.09, 0.08]) {
      const pt = facePoint(hx + side * dx, frontY + p.rideHeight, 1, 0.035);
      const reflector = MeshBuilder.CreateCylinder(
        name + '-reflector',
        { diameter: truck ? 0.105 : 0.087, height: 0.016, tessellation: 12 },
        scene,
      );
      reflector.parent = root;
      reflector.position.copyFromFloats(...(pt as [number, number, number]));
      reflector.rotation.x = Math.PI / 2;
      reflector.material = alloy;
      const bulb = MeshBuilder.CreateCylinder(
        name + '-headlight-projector',
        { diameter: truck ? 0.06 : 0.043, height: 0.018, tessellation: 12 },
        scene,
      );
      bulb.parent = root;
      bulb.position.copyFrom(reflector.position);
      bulb.position.z += 0.012;
      bulb.rotation.x = Math.PI / 2;
      bulb.material = front;
      lamps.push(bulb);
    }
    const edge = frontOutline.slice(0, 2);
    lamps.push(
      facePanel(
        'headlight-drl',
        [
          [edge[0][0], edge[0][1] + 0.012],
          [edge[1][0], edge[1][1] + 0.012],
          [edge[1][0], edge[1][1] + 0.025],
          [edge[0][0], edge[0][1] + 0.025],
        ],
        front,
        1,
        0.03,
      ),
    );
    for (const end of [-1, 1]) {
      const cy = (end > 0 ? frontY : rearY) + p.rideHeight;
      indicators[side < 0 ? 0 : 1].push(
        facePanel(
          'turn-light',
          [
            [side * 0.83, cy - 0.028],
            [side * 0.89, cy - 0.028],
            [side * 0.89, cy + 0.028],
            [side * 0.83, cy + 0.028],
          ],
          amber,
          end,
          0.035,
        ),
      );
      const outline = end > 0 ? shape.sideHeadlamp : shape.sideTaillamp;
      if (!outline.length) continue;
      const lampDrop = Math.max(
        0,
        ...outline.map(([zz, yy]) => {
          const z = zz * p.length;
          return (
            yy -
            p.rideHeight -
            (z < cr || z > cf ? shoulder(z) : cabinTop(z)) +
            0.009
          );
        }),
      );
      const sideLamp = (id: string, mat: Material, offset: number) =>
        fittedPanel(
          id,
          outline,
          (zz, yy) => {
            const z = zz * p.length,
              y = yy - p.rideHeight - lampDrop;
            const c = cabinSection(z),
              rise = (y - beltAt(z)) / Math.max(0.01, c.height - beltAt(z));
            const xx =
              y <= beltAt(z)
                ? sideWidth(z, y)
                : cabinWidthAt(z) +
                  (c.topWidth - cabinWidthAt(z)) *
                    Math.max(0, Math.min(1, rise));
            return [side * (xx + offset), y, z];
          },
          mat,
          new Vector3(side, 0, 0),
        );
      lamps.push(
        sideLamp(
          end > 0 ? 'headlight-wrap' : 'taillight-wrap',
          end > 0 ? lens : rear,
          0.014,
        ),
      );
      if (end < 0) brakeLights.push(sideLamp('brake-light-wrap', brake, 0.02));
    }
    if (!truck)
      box(
        'exhaust',
        side * 0.48,
        base - 0.015,
        -half - 0.04,
        0.09,
        0.075,
        0.1,
        alloy,
      );
  }
  if (shape.form === 'hatch' || shape.form === 'van') {
    box(
      'rear-wiper',
      0,
      (shape.rearGlass
        ? contourHeight(shape.roof, shape.rearGlass[0] + 0.025)
        : 1.4) - p.rideHeight,
      -half + 0.09,
      0.32,
      0.017,
      0.025,
      dark,
    );
    brakeLights.push(
      box('third-brake', 0, roof - 0.025, rr - 0.07, 0.27, 0.026, 0.025, brake),
    );
    box(
      'roof-spoiler',
      0,
      cabinTop(rr) + 0.025,
      rr - 0.05,
      roofWidth * 1.85,
      0.045,
      0.16,
      paint,
    );
  } else if (!truck)
    brakeLights.push(
      box(
        'third-brake',
        0,
        beltAt(cr) + 0.07,
        cr + 0.03,
        0.24,
        0.024,
        0.025,
        brake,
      ),
    );
  for (const side of [-1, 1]) {
    const z = cf - 0.1,
      y = cabinTop(z) + 0.015;
    const wiper = box(
      'windscreen-wiper',
      side * 0.3,
      y,
      z,
      0.4,
      0.014,
      0.018,
      dark,
    );
    wiper.rotation.y = side * 0.12;
  }
  const wheels: TransformNode[] = [];
  for (const z of axles)
    for (const x of [-p.track / 2, p.track / 2]) {
      const pivot = new TransformNode(name + '-wheel-pivot', scene);
      pivot.parent = root;
      pivot.position.set(x, wheelY, z);
      const tyre = MeshBuilder.CreateLathe(
        name + '-tyre',
        {
          shape: [
            [0.72, -0.125],
            [0.94, -0.11],
            [1, -0.06],
            [1, 0.06],
            [0.94, 0.11],
            [0.72, 0.125],
          ].map(([r, y]) => new Vector3(p.wheelRadius * r, y, 0)),
          tessellation: 32,
          cap: Mesh.NO_CAP,
        },
        scene,
      );
      tyre.rotation.z = Math.PI / 2;
      tyre.parent = pivot;
      tyre.material = dark;
      const parts: Mesh[] = [];
      for (const side of [-1, 1]) {
        const rim = MeshBuilder.CreateCylinder(
          name + '-rim',
          {
            diameter: p.wheelRadius * 2 * shape.rim[1],
            height: 0.015,
            tessellation: 24,
          },
          scene,
        );
        rim.rotation.z = Math.PI / 2;
        rim.parent = pivot;
        rim.position.x = side * 0.119;
        rim.material = alloy;
        parts.push(rim);
        const inset = MeshBuilder.CreateCylinder(
          name + '-rim-inset',
          {
            diameter: p.wheelRadius * (2 * shape.rim[1] - 0.15),
            height: 0.018,
            tessellation: 24,
          },
          scene,
        );
        inset.rotation.z = Math.PI / 2;
        inset.parent = pivot;
        inset.position.x = side * 0.13;
        inset.material = dark;
        for (let i = 0; i < shape.rim[0]; i++)
          for (const split of shape.rim[2] ? [-1, 1] : [0]) {
            const angle = (i * Math.PI * 2) / shape.rim[0] + split * 0.047,
              inner = p.wheelRadius * 0.18,
              outer = p.wheelRadius * shape.rim[1] * 0.92;
            const points = [
              [inner, angle - 0.095],
              [outer, angle - 0.045],
              [outer, angle + 0.045],
              [inner, angle + 0.095],
            ].map(([r, a]) => [side * 0.149, r * Math.cos(a), r * Math.sin(a)]);
            const spoke = panel(
              'spoke',
              points,
              alloy,
              new Vector3(side, 0, 0),
            );
            spoke.parent = pivot;
            parts.push(spoke);
          }
        const hub = MeshBuilder.CreateCylinder(
          name + '-wheel-hub',
          { diameter: p.wheelRadius * 0.32, height: 0.025, tessellation: 16 },
          scene,
        );
        hub.rotation.z = Math.PI / 2;
        hub.parent = pivot;
        hub.position.x = side * 0.15;
        hub.material = alloy;
        parts.push(hub);
      }
      if (truck && z < 0) {
        const innerTyre = MeshBuilder.CreateCylinder(
          name + '-dual-tyre',
          { diameter: p.wheelRadius * 2, height: 0.2, tessellation: 24 },
          scene,
        );
        innerTyre.rotation.z = Math.PI / 2;
        innerTyre.parent = pivot;
        innerTyre.position.x = x > 0 ? -0.23 : 0.23;
        innerTyre.material = dark;
      }
      const merged = Mesh.MergeMeshes(parts, true, true)!;
      merged.bakeTransformIntoVertices(Matrix.Translation(-x, -wheelY, -z));
      merged.parent = pivot;
      merged.name = name + '-wheel-alloy';
      const rubberParts = pivot
        .getChildMeshes()
        .filter((m) => m.material === dark) as Mesh[];
      const rubber = Mesh.MergeMeshes(rubberParts, true, true)!;
      rubber.bakeTransformIntoVertices(Matrix.Translation(-x, -wheelY, -z));
      rubber.parent = pivot;
      rubber.name = name + '-wheel-tyre';
      wheels.push(pivot);
    }
  const mergeLights = (
    parts: AbstractMesh[],
    id: string,
    y: number,
    z: number,
  ) => {
    if (!parts.length) return [];
    const merged = Mesh.MergeMeshes(parts as Mesh[], true, true)!;
    merged.bakeTransformIntoVertices(Matrix.Translation(0, -y, -z));
    merged.parent = root;
    merged.position.set(0, y, z);
    merged.name = name + '-' + id;
    return [merged];
  };
  const constantLights = [
    ...mergeLights(
      lamps.filter((m) => m.material === front),
      'headlight',
      frontY,
      half + 0.08,
    ),
    ...mergeLights(
      lamps.filter((m) => m.material === lens),
      'headlight-lens',
      frontY,
      half + 0.08,
    ),
    ...mergeLights(
      lamps.filter((m) => m.material === rear),
      'taillight',
      rearY,
      -half - 0.04,
    ),
  ];
  lamps.splice(0, lamps.length, ...constantLights);
  brakeLights.splice(
    0,
    brakeLights.length,
    ...mergeLights([...brakeLights], 'brake-light', rearY, -half - 0.06),
  );
  for (let i = 0; i < 2; i++)
    indicators[i] = mergeLights(indicators[i], 'indicator-' + i, 0, 0);
  const lights = new Set([...lamps, ...brakeLights, ...indicators.flat()]);
  for (const mat of [paint, glass, dark, alloy, cargo]) {
    const parts = root
      .getChildMeshes()
      .filter(
        (m) => m.parent === root && m.material === mat && !lights.has(m),
      ) as Mesh[];
    if (parts.length) {
      const m = Mesh.MergeMeshes(parts, true, true)!;
      m.parent = root;
      m.name = name + '-trim-' + mat.name;
      m.isPickable = false;
    }
  }
  root.getChildMeshes().forEach((m) => {
    m.isPickable = false;
    m.receiveShadows = true;
    m.metadata = { vehicle: true };
  });
  brakeLights.forEach((m) => (m.isVisible = false));
  indicators.flat().forEach((m) => (m.isVisible = false));
  return {
    root,
    wheels,
    lamps,
    brakeLights,
    indicators,
    materials,
    profile: p,
    dispose: () => {
      root.dispose();
      materials.forEach((m) => m.dispose());
    },
  };
}
