import {
  Constants,
  MeshBuilder,
  Quaternion,
  RawTexture,
  StandardMaterial,
  Texture,
  Vector3,
  type Scene,
} from '@babylonjs/core';
import type { CarVisual } from './visuals';
import type { SurfaceContact } from './surface-contact';

function shadowPixels(size: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = ((x + 0.5) / size) * 2 - 1,
        v = ((y + 0.5) / size) * 2 - 1;
      const fade = Math.max(0, 1 - u * u - v * v);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 9;
      data[i + 3] = Math.round(255 * fade * fade);
    }
  return data;
}

export class VehicleContactShadows {
  private texture: RawTexture;
  private material: StandardMaterial;
  private meshes;
  constructor(
    scene: Scene,
    private surface?: (
      x: number,
      z: number,
      referenceY: number,
    ) => SurfaceContact,
  ) {
    const size = 64;
    this.texture = new RawTexture(
      shadowPixels(size),
      size,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    this.texture.hasAlpha = true;
    this.material = new StandardMaterial(
      'vehicle-contact-shadow-material',
      scene,
    );
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.disableLighting = true;
    this.material.specularColor.setAll(0);
    this.material.backFaceCulling = false;
    this.meshes = Array.from({ length: 7 }, (_, i) => {
      const body = MeshBuilder.CreateGround(
        'vehicle-contact-shadow-' + i,
        { width: 2.35, height: 3.7 },
        scene,
      );
      const wheels = [-1, 1].flatMap((side) =>
        [-1, 1].map((end) =>
          MeshBuilder.CreateGround(
            `vehicle-contact-shadow-${i}-wheel-${side}-${end}`,
            { width: 0.62, height: 1.15 },
            scene,
          ),
        ),
      );
      for (const mesh of [body, ...wheels]) {
        mesh.material = this.material;
        mesh.isPickable = false;
        mesh.receiveShadows = false;
        mesh.setEnabled(false);
        mesh.rotationQuaternion = Quaternion.Identity();
      }
      return { body, wheels };
    });
  }
  update(player: CarVisual, traffic: CarVisual[], daylight: number) {
    this.material.alpha = 0.18 + 0.34 * daylight;
    const distanceSquared = (car: CarVisual) => {
      const a = car.root.position,
        b = player.root.position;
      return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    };
    const cars = [
      player,
      ...traffic
        .filter((car) => car.root.isEnabled() && distanceSquared(car) < 65 * 65)
        .sort((a, b) => distanceSquared(a) - distanceSquared(b))
        .slice(0, this.meshes.length - 1),
    ];
    this.meshes.forEach((entry, i) => {
      const car = cars[i];
      for (const mesh of [entry.body, ...entry.wheels]) mesh.setEnabled(!!car);
      if (!car) return;
      const contact = this.surface?.(
          car.root.position.x,
          car.root.position.z,
          car.root.position.y,
        ) ?? { height: car.root.position.y - 0.83, normal: Vector3.Up() },
        bias = this.surface ? 0.018 : 0;
      const rawForward = car.root.getDirection(Vector3.Forward()),
        forward = rawForward
          .subtract(
            contact.normal.scale(Vector3.Dot(rawForward, contact.normal)),
          )
          .normalize();
      const right = Vector3.Cross(contact.normal, forward).normalize(),
        rotation = Quaternion.FromLookDirectionLH(forward, contact.normal),
        center = new Vector3(
          car.root.position.x,
          contact.height + bias,
          car.root.position.z,
        );
      entry.body.position.copyFrom(center);
      entry.body.rotationQuaternion!.copyFrom(rotation);
      entry.body.computeWorldMatrix(true);
      entry.wheels.forEach((mesh, index) => {
        const side = index < 2 ? -1 : 1,
          end = index % 2 ? -1 : 1;
        mesh.position.copyFrom(
          center.add(right.scale(side * 0.88)).add(forward.scale(end * 1.15)),
        );
        mesh.rotationQuaternion!.copyFrom(rotation);
        mesh.computeWorldMatrix(true);
      });
    });
  }
  dispose() {
    this.meshes.forEach((entry) => {
      entry.body.dispose();
      entry.wheels.forEach((mesh) => mesh.dispose());
    });
    this.material.dispose();
    this.texture.dispose();
  }
}
