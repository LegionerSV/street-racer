import type { Breakable } from './types';

type MovingBody = { getLinearVelocity: () => { x: number; z: number } };

export class ImpactSpeeds {
  private beforeStep = new WeakMap<MovingBody, number>();
  capture(body: MovingBody) {
    const velocity = body.getLinearVelocity();
    this.beforeStep.set(body, Math.hypot(velocity.x, velocity.z));
  }
  atContact(body: MovingBody) {
    if (this.beforeStep.has(body)) return this.beforeStep.get(body)!;
    const velocity = body.getLinearVelocity();
    return Math.hypot(velocity.x, velocity.z);
  }
}

export function shouldBreak(prop: Pick<Breakable, 'kind' | 'fenceType'>, impulse: number, speedMetersPerSecond: number) {
  if (prop.kind === 'pole') return impulse >= 500;
  if (prop.fenceType === 'embankment') return speedMetersPerSecond > 120 / 3.6 && impulse >= 500;
  return impulse >= 120;
}
