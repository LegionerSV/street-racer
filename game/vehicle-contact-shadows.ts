import { Constants, MeshBuilder, RawTexture, StandardMaterial, Texture, Vector3, type Scene } from '@babylonjs/core';
import type { CarVisual } from './visuals';

function shadowPixels(size: number) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + .5) / size * 2 - 1, v = (y + .5) / size * 2 - 1;
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
  constructor(scene: Scene) {
    const size = 64;
    this.texture = new RawTexture(shadowPixels(size), size, size, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    this.texture.hasAlpha = true;
    this.material = new StandardMaterial('vehicle-contact-shadow-material', scene);
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.disableLighting = true;
    this.material.specularColor.setAll(0);
    this.material.backFaceCulling = false;
    this.meshes = Array.from({ length: 7 }, (_, i) => {
      const mesh = MeshBuilder.CreateGround('vehicle-contact-shadow-' + i, { width: 2.8, height: 5.4 }, scene);
      mesh.material = this.material;
      mesh.isPickable = false;
      mesh.receiveShadows = false;
      mesh.setEnabled(false);
      return mesh;
    });
  }
  update(player: CarVisual, traffic: CarVisual[], daylight: number) {
    this.material.alpha = .18 + .34 * daylight;
    const distanceSquared = (car: CarVisual) => {
      const a = car.root.position, b = player.root.position;
      return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
    };
    const cars = [player, ...traffic
      .filter(car => car.root.isEnabled() && distanceSquared(car) < 65 * 65)
      .sort((a, b) => distanceSquared(a) - distanceSquared(b))
      .slice(0, this.meshes.length - 1)];
    this.meshes.forEach((mesh, i) => {
      const car = cars[i];
      mesh.setEnabled(!!car);
      if (!car) return;
      mesh.position.set(car.root.position.x, car.root.position.y - .83, car.root.position.z);
      const forward = car.root.getDirection(Vector3.Forward());
      mesh.rotation.y = Math.atan2(forward.x, forward.z);
    });
  }
  dispose() {
    this.meshes.forEach(mesh => mesh.dispose());
    this.material.dispose();
    this.texture.dispose();
  }
}
