import {
  HavokPlugin,
  PhysicsAggregate,
  PhysicsMotionType,
  PhysicsPrestepType,
  PhysicsShapeType,
  Scene,
  Vector3,
  type Observer,
} from '@babylonjs/core';
import { setCarLights, type CarVisual } from './visuals';

export type TrafficCarLease = {
  key: string;
  visual: CarVisual;
  body: PhysicsAggregate;
  membershipMask: number;
  collideMask: number;
  readyAfterStep: number;
  onImpact?: () => void;
};

export class TrafficCarPool {
  private idle: TrafficCarLease[] = [];
  private physicsStep = 0;
  private afterPhysics?: Observer<Scene>;
  constructor(
    private scene: Scene,
    private capacity = 32,
  ) {}

  take(key: string, create: () => CarVisual): TrafficCarLease {
    this.afterPhysics ??= this.scene.onAfterPhysicsObservable.add(() => {
      this.physicsStep++;
    });
    const i = this.idle.findIndex(
      (entry) => entry.key === key && entry.readyAfterStep <= this.physicsStep,
    );
    if (i >= 0) return this.idle.splice(i, 1)[0];
    const visual = create();
    let aggregate: PhysicsAggregate;
    try {
      aggregate = new PhysicsAggregate(
        visual.root,
        PhysicsShapeType.BOX,
        { mass: 1200, friction: 0.18, restitution: 0.04 },
        this.scene,
      );
    } catch (error) {
      visual.dispose();
      throw error;
    }
    aggregate.body.setMassProperties({
      mass: 1200,
      centerOfMass: new Vector3(0, -0.38, 0),
      inertia: new Vector3(1700 / 1200, 2100 / 1200, 760 / 1200),
    });
    const entry: TrafficCarLease = {
      key,
      visual,
      body: aggregate,
      membershipMask: aggregate.shape.filterMembershipMask,
      collideMask: aggregate.shape.filterCollideMask,
      readyAfterStep: 0,
    };
    aggregate.body.getCollisionObservable().add((event) => {
      if (event.impulse > 400) entry.onImpact?.();
    });
    return entry;
  }

  activate(entry: TrafficCarLease, onImpact: () => void) {
    const { visual, body: aggregate } = entry,
      body = aggregate.body;
    entry.onImpact = onImpact;
    visual.root.setEnabled(true);
    setCarLights(visual, false, 0, 0);
    for (const wheel of visual.wheels) {
      wheel.position.y =
        -visual.profile.rideHeight + visual.profile.wheelRadius;
      wheel.rotation.setAll(0);
      for (const child of wheel.getChildMeshes()) child.rotation.x = 0;
    }
    aggregate.shape.filterMembershipMask = entry.membershipMask;
    aggregate.shape.filterCollideMask = entry.collideMask;
    body.setMotionType(PhysicsMotionType.ANIMATED);
    body.setLinearVelocity(Vector3.Zero());
    body.setAngularVelocity(Vector3.Zero());
    body.setAngularDamping(0);
    body.setGravityFactor(1);
    body.disableSync = false;
    visual.root.computeWorldMatrix(true);
    body.setPrestepType(PhysicsPrestepType.TELEPORT);
    (
      this.scene.getPhysicsEngine()!.getPhysicsPlugin() as HavokPlugin
    ).setPhysicsBodyTransformation(body, visual.root);
    body.disablePreStep = true;
    body.setCollisionCallbackEnabled(true);
  }

  release(entry: TrafficCarLease) {
    entry.onImpact = undefined;
    entry.visual.root.setEnabled(false);
    const body = entry.body.body;
    body.setCollisionCallbackEnabled(false);
    body.setLinearVelocity(Vector3.Zero());
    body.setAngularVelocity(Vector3.Zero());
    body.setMotionType(PhysicsMotionType.STATIC);
    // Скрытые машины не участвуют ни в столкновениях, ни в лучах подвески.
    entry.body.shape.filterMembershipMask = 0;
    entry.body.shape.filterCollideMask = 0;
    body.disableSync = true;
    // Havok должен исполнить старую цель на скрытом теле до повторного использования.
    entry.readyAfterStep = this.physicsStep + 1;
    this.idle.push(entry);
    if (this.idle.length > this.capacity) this.destroy(this.idle.shift()!);
  }

  private destroy(entry: TrafficCarLease) {
    entry.body.dispose();
    entry.visual.dispose();
  }

  dispose() {
    if (this.afterPhysics) {
      this.scene.onAfterPhysicsObservable.remove(this.afterPhysics);
      this.afterPhysics = undefined;
    }
    this.idle.forEach((entry) => this.destroy(entry));
    this.idle = [];
  }
}
