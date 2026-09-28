import {
  Color3,
  FreeCamera,
  Mesh,
  MeshBuilder,
  PhysicsAggregate,
  PhysicsMotionType,
  PhysicsShapeType,
  Quaternion,
  Scene,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { pathLengths, pointAt } from './geo';
import { pointHasCoverage } from './stream-coverage';
import {
  advanceTrainProgress,
  trainCooldown,
  trainOpportunity,
} from './railways';
import type { Point, RailLine, World } from './types';

type Car = {
  mesh: Mesh;
  body: PhysicsAggregate;
  membershipMask: number;
  collideMask: number;
};

export class TrainTraffic {
  private active: {
    line: RailLine;
    lengths: number[];
    progress: number;
    direction: 1 | -1;
    cars: Car[];
  } | null = null;
  private elapsed = 0;
  private nextAt = 480;
  private wagonMaterial: StandardMaterial;
  private engineMaterial: StandardMaterial;

  constructor(
    private scene: Scene,
    private world: World,
  ) {
    this.wagonMaterial = new StandardMaterial('train-wagons', scene);
    this.wagonMaterial.diffuseColor = new Color3(0.39, 0.2, 0.14);
    this.engineMaterial = new StandardMaterial('train-engine', scene);
    this.engineMaterial.diffuseColor = new Color3(0.2, 0.31, 0.35);
  }

  setWorld(world: World) {
    this.world = world;
    if (!this.active) return;
    const line = world.railways?.find(
      (candidate) => candidate.id === this.active!.line.id,
    );
    if (!line) {
      this.clear();
      this.nextAt = this.elapsed + trainCooldown(Math.random());
    }
    else {
      this.active.line = line;
      this.active.lengths = pathLengths(line.points);
    }
  }

  private clear() {
    for (const car of this.active?.cars ?? []) {
      car.body.dispose();
      car.mesh.dispose();
    }
    this.active = null;
  }

  private visible(point: Point, camera: FreeCamera, player: Vector3) {
    const position = new Vector3(point.x, point.y + 2, point.z);
    const direction = position.subtract(camera.position);
    return (
      Vector3.DistanceSquared(position, player) < 850 * 850 &&
      direction.lengthSquared() > 1 &&
      Vector3.Dot(direction.normalize(), camera.getForwardRay().direction) >
        0.55
    );
  }

  private spawn(line: RailLine, direction: 1 | -1) {
    const lengths = pathLengths(line.points),
      total = lengths.at(-1)!;
    const cars: Car[] = [];
    for (let i = 0; i < 4; i++) {
      const engine = i === 0,
        height = engine ? 3.6 : 3;
      const mesh = MeshBuilder.CreateBox(
        `train-${line.id}-${i}`,
        { width: 2.9, height, depth: engine ? 15 : 12 },
        this.scene,
      );
      mesh.material = engine ? this.engineMaterial : this.wagonMaterial;
      const distance = 65 - i * 18;
      const pose = pointAt(
        line.points,
        lengths,
        direction === 1 ? distance : total - distance,
      );
      mesh.position.set(pose.point.x, pose.point.y + height / 2, pose.point.z);
      mesh.rotationQuaternion = Quaternion.RotationYawPitchRoll(
        pose.heading + (direction === 1 ? 0 : Math.PI),
        0,
        0,
      );
      const body = new PhysicsAggregate(
        mesh,
        PhysicsShapeType.BOX,
        { mass: 1200, friction: 0.7, restitution: 0.02 },
        this.scene,
      );
      body.body.setMotionType(PhysicsMotionType.ANIMATED);
      body.body.setCollisionCallbackEnabled(true);
      cars.push({
        mesh,
        body,
        membershipMask: body.shape.filterMembershipMask,
        collideMask: body.shape.filterCollideMask,
      });
    }
    this.active = { line, lengths, progress: 65, direction, cars };
  }

  step(dt: number, paused: boolean, player: Vector3, camera: FreeCamera) {
    if (paused) return;
    this.elapsed += dt;
    if (!this.active && this.elapsed >= this.nextAt) {
      this.nextAt = this.elapsed + 5;
      const loaded = this.world.loadedTiles && new Set(this.world.loadedTiles);
      const covered = (point: Point) =>
        pointHasCoverage(loaded, point, this.world.center);
      const visible = (point: Point) => this.visible(point, camera, player);
      const line = trainOpportunity(
        this.world.railways ?? [],
        this.elapsed,
        visible,
        covered,
      );
      if (line) {
        const lengths = pathLengths(line.points),
          total = lengths.at(-1)!;
        const forward =
          !visible(line.points[0]) &&
          !visible(pointAt(line.points, lengths, 65).point);
        const reverse =
          !visible(line.points.at(-1)!) &&
          !visible(pointAt(line.points, lengths, total - 65).point);
        if (forward || reverse) this.spawn(line, forward ? 1 : -1);
      }
    }
    if (!this.active) return;
    const train = this.active;
    train.progress = advanceTrainProgress(train.progress, dt, false);
    const total = train.lengths.at(-1)!;
    if (train.progress > total + train.cars.length * 18) {
      this.clear();
      this.nextAt = this.elapsed + trainCooldown(Math.random());
      return;
    }
    train.cars.forEach((car, index) => {
      const distance = train.progress - index * 18;
      if (distance < 0 || distance > total) {
        car.mesh.setEnabled(false);
        car.body.shape.filterMembershipMask = 0;
        car.body.shape.filterCollideMask = 0;
        return;
      }
      car.mesh.setEnabled(true);
      car.body.shape.filterMembershipMask = car.membershipMask;
      car.body.shape.filterCollideMask = car.collideMask;
      const pose = pointAt(
        train.line.points,
        train.lengths,
        train.direction === 1 ? distance : total - distance,
      );
      car.body.body.setTargetTransform(
        new Vector3(
          pose.point.x,
          pose.point.y + (index === 0 ? 1.8 : 1.5),
          pose.point.z,
        ),
        Quaternion.RotationYawPitchRoll(
          pose.heading + (train.direction === 1 ? 0 : Math.PI),
          0,
          0,
        ),
      );
    });
  }

  dispose() {
    this.clear();
    this.wagonMaterial.dispose();
    this.engineMaterial.dispose();
  }
}
