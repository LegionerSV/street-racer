import { createCar } from './vehicle-model';
import {
  DEFAULT_MODELS,
  type CarKind,
  type PaintFinish,
  type VehicleModelId,
  type VehicleProfile,
} from './vehicle-profiles';
export { createCar } from './vehicle-model';
export type { CarKind } from './vehicle-profiles';
import {
  Color3,
  Mesh,
  StandardMaterial,
  TransformNode,
  Scene,
  Material,
  AbstractMesh,
} from '@babylonjs/core';
export function material(
  scene: Scene,
  name: string,
  colour: string,
  glow = false,
) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(colour);
  mat.specularColor = new Color3(0.18, 0.2, 0.22);
  if (glow) {
    mat.emissiveColor = mat.diffuseColor;
    mat.disableLighting = true;
  }
  return mat;
}
export { makeEnvironment } from './vehicle-environment';
export type CarVisual = {
  root: Mesh;
  profile: VehicleProfile;
  wheels: TransformNode[];
  lamps: AbstractMesh[];
  brakeLights: AbstractMesh[];
  indicators: [AbstractMesh[], AbstractMesh[]];
  materials: Material[];
  dispose: () => void;
};
export function setCarLights(
  car: CarVisual,
  braking: boolean,
  turn: number,
  time: number,
) {
  car.brakeLights.forEach((m) => (m.isVisible = braking));
  car.indicators.forEach((side, i) =>
    side.forEach(
      (m) => (m.isVisible = turn === (i === 0 ? -1 : 1) && time % 0.8 < 0.4),
    ),
  );
}
const trafficModels = new WeakMap<Scene, Map<string, CarVisual>>();
const trafficMaterials = new WeakMap<Scene, Map<string, Material>>();
const trafficGeometry = new WeakMap<Scene, Map<string, Mesh[]>>();
export function createTrafficCar(
  scene: Scene,
  color: string,
  name: string,
  kind: CarKind = 'sedan',
  racing = false,
  model: VehicleModelId = DEFAULT_MODELS[kind],
  finish: PaintFinish = 'standard',
): CarVisual {
  let palette = trafficModels.get(scene);
  if (!palette) {
    palette = new Map();
    trafficModels.set(scene, palette);
  }
  const key = model + color + finish + (racing ? '-racing' : '');
  let source = palette.get(key);
  if (!source) {
    source = createCar(
      scene,
      color,
      'shared-' + key,
      kind,
      racing,
      model,
      finish,
    );
    let geometries = trafficGeometry.get(scene);
    if (!geometries) {
      geometries = new Map();
      trafficGeometry.set(scene, geometries);
    }
    const geometryKey = model + finish + (racing ? '-racing' : ''),
      meshes = [source.root, ...source.root.getChildMeshes()] as Mesh[];
    const template = geometries.get(geometryKey);
    if (template)
      meshes.forEach((mesh, i) => {
        const previous = mesh.geometry;
        template[i].geometry!.applyToMesh(mesh);
        previous?.dispose();
      });
    else geometries.set(geometryKey, meshes);
    let shared = trafficMaterials.get(scene);
    if (!shared) {
      shared = new Map();
      trafficMaterials.set(scene, shared);
    }
    source.materials = source.materials.map((mat) => {
      const role = mat.name.split('-').at(-1)!;
      const materialKey =
        role +
        (role === 'paint' ? color + finish : role === 'alloy' ? finish : '');
      const cached = shared.get(materialKey);
      if (!cached) {
        shared.set(materialKey, mat);
        return mat;
      }
      source!.root
        .getChildMeshes()
        .filter((mesh) => mesh.material === mat)
        .forEach((mesh) => (mesh.material = cached));
      mat.dispose();
      return cached;
    });
    source.root.getChildMeshes().forEach((m) => (m.isVisible = false));
    palette.set(key, source);
  }
  const root = source.root.clone(name, null, true)!;
  root.isVisible = false;
  root.isPickable = false;
  const wheels: TransformNode[] = [],
    lamps: AbstractMesh[] = [],
    brakeLights: AbstractMesh[] = [],
    indicators: [AbstractMesh[], AbstractMesh[]] = [[], []];
  function copy(parent: TransformNode, target: TransformNode) {
    for (const child of parent.getChildren()) {
      if (!(child instanceof TransformNode)) continue;
      const instance =
        child instanceof Mesh
          ? child.createInstance(name + '-' + child.name)
          : new TransformNode(name + '-' + child.name, scene);
      instance.parent = target;
      instance.position.copyFrom(child.position);
      instance.rotation.copyFrom(child.rotation);
      instance.scaling.copyFrom(child.scaling);
      instance.rotationQuaternion = child.rotationQuaternion?.clone() || null;
      if (child instanceof Mesh) {
        const m = instance as AbstractMesh;
        m.isVisible = true;
        m.isPickable = false;
        m.receiveShadows = true;
        m.metadata = { vehicle: true };
        if (source!.lamps.includes(child)) lamps.push(m);
        if (source!.brakeLights.includes(child)) brakeLights.push(m);
        for (let i = 0; i < 2; i++)
          if (source!.indicators[i].includes(child)) indicators[i].push(m);
      }
      if (source!.wheels.includes(child)) wheels.push(instance);
      copy(child, instance);
    }
  }
  copy(source.root, root);
  const car = {
    root,
    profile: source.profile,
    wheels,
    lamps,
    brakeLights,
    indicators,
    materials: [],
    dispose: () => root.dispose(),
  };
  setCarLights(car, false, 0, 0);
  return car;
}
