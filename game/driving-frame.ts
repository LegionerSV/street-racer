import { Vector3, type Scene } from '@babylonjs/core';

// Сначала фиксированные шаги всей симуляции, затем камера и отрисовка.
// 250 мс позволяют пережить просадку до 4 FPS без замедления времени;
// после долгого зависания не пытаемся проиграть секунды физики за один кадр.
export function advanceDrivingPhysics(
  scene: Scene,
  elapsedMs: number,
  active: boolean,
) {
  if (active)
    scene._advancePhysicsEngineStep(Math.max(0, Math.min(250, elapsedMs)));
  scene.physicsEnabled = false;
}

export class ChasePosition {
  private previous: Vector3 | null = null;
  update(
    player: Vector3,
    desired: Vector3,
    look: Vector3,
    camera: Vector3,
    target: Vector3,
    dt: number,
    obstructed = false,
  ) {
    if (
      !this.previous ||
      Vector3.DistanceSquared(player, this.previous) > 625
    ) {
      camera.copyFrom(desired);
      target.copyFrom(look);
    } else {
      // Перенос вместе с машиной не сглаживаем: иначе на скорости камера
      // постоянно отстаёт на speed / smoothing метров и меняет масштаб машины.
      const translation = player.subtract(this.previous);
      camera.addInPlace(translation);
      target.addInPlace(translation);
      if (obstructed) camera.copyFrom(desired);
      else Vector3.LerpToRef(camera, desired, 1 - Math.exp(-dt * 7), camera);
      Vector3.LerpToRef(target, look, 1 - Math.exp(-dt * 12), target);
    }
    (this.previous ??= Vector3.Zero()).copyFrom(player);
  }
}
