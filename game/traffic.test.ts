import { describe, it, expect } from 'vitest';
import { NullEngine, Scene, Vector3, HavokPlugin, FreeCamera } from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import { readFile } from 'node:fs/promises';
import { buildWorld } from './network';
import { Traffic } from './traffic';
import type { OSMElement, RegionData } from './types';

describe('Соперники', () => {
  it('все три бота проходят три круга и получают время финиша', async () => {
    // Arrange
    const elements: OSMElement[] = [[1, -.0005, -.0005], [2, .0005, -.0005], [3, .0005, .0005], [4, -.0005, .0005]].map(([id, lon, lat]) => ({ type: 'node', id, lat, lon }));
    elements.push({ type: 'way', id: 100, nodes: [1, 2, 3, 4, 1], tags: { highway: 'residential', oneway: 'yes' } });
    const region: RegionData = { center: { lat: 0, lon: 0 }, elements, elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', fetchedAt: 'test' };
    const world = buildWorld(region), route = world.routes.find(r => r.kind === 'circuit')!;
    const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
    const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    const traffic = new Traffic(scene, world); traffic.startRace(route);
    try {
      // Act
      for (let i = 0; i < 9000; i++) traffic.update(1 / 60, i / 60, { x: -450, y: 0, z: -450 }, 0, true, i / 60);
      // Assert
      expect(traffic.racers).toHaveLength(3);
      for (const racer of traffic.racers) { expect(racer.race!.finished, JSON.stringify(traffic.racers.map(a => ({ id: a.id, edge: a.edge, distance: a.distance, speed: a.speed, lap: a.race?.lap, finished: a.race?.finished })))).toBe(true); expect(racer.race!.lap).toBe(3); expect(racer.race!.finishTime).toBeGreaterThan(20); }
    } finally { traffic.dispose(); scene.dispose(); engine.dispose(); }
  }, 20000);
});

it('стартовая решётка проходит короткие OSM-сегменты, а видимые машины следуют за физикой', async () => {
  // Arrange
  const elements: OSMElement[] = [];
  for (let i = 0; i <= 30; i++) elements.push({ type: 'node', id: i + 1, lat: i * .00009, lon: 0 });
  elements.push({ type: 'way', id: 1, nodes: Array.from({ length: 31 }, (_, i) => i + 1), tags: { highway: 'primary', oneway: 'yes' } });
  const world = buildWorld({ center: { lat: 0, lon: 0 }, elements, elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', fetchedAt: 'test' });
  const points = world.nodes, route = { id: 'short', kind: 'sprint' as const, title: 'Короткие сегменты', edges: world.edges.map(e => e.id), points, cumulative: points.map((_, i) => i * 10), length: 300, laps: 1 };
  const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const traffic = new Traffic(scene, world); traffic.startRace(route);
  try {
    // Assert — три разные позиции на маршруте, даже если первое ребро короче решётки.
    expect(new Set(traffic.racers.map(a => a.point.z.toFixed(2))).size).toBe(3);
    // Act
    for (let i = 0; i < 600; i++) { traffic.update(1 / 60, i / 60, { x: 100, y: 1, z: 0 }, 0, true, i / 60); scene.getPhysicsEngine()!._step(1 / 60); }
    // Assert
    for (const racer of traffic.racers) {
      expect(racer.race!.progress).toBeGreaterThan(70);
      expect(racer.visual).toBeDefined();
      expect(racer.visual!.root.position.z).toBeGreaterThan(60);
      expect(Math.abs(racer.visual!.root.position.z - racer.point.z)).toBeLessThan(1);
    }
  } finally { traffic.dispose(); scene.dispose(); engine.dispose(); }
}, 20000);

it('заполняет городской район плотным потоком и распределяет машины по нескольким полосам', async () => {
  // Arrange
  const elements: OSMElement[] = [];
  for (let i = 0; i < 20; i++) {
    elements.push({ type: 'node', id: i*2+1, lat: (i-10)*.00018, lon: .0009 }, { type: 'node', id: i*2+2, lat: (i-10)*.00018, lon: .0039 });
    elements.push({ type: 'way', id: 100+i, nodes: [i*2+1,i*2+2], tags: { highway: 'primary', lanes: '4', oneway: 'yes' } });
  }
  const world = buildWorld({ center: { lat: 0, lon: 0 }, elements, elevation: { width: 2, size: 5600, values: new Float32Array(4) }, drivingSide: 'right', fetchedAt: 'test' });
  const havok = await HavokPhysics({ wasmBinary: Uint8Array.from(await readFile(new URL('../node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm', import.meta.url))).buffer });
  const engine = new NullEngine(), scene = new Scene(engine); scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
  const traffic = new Traffic(scene, world); traffic.setDensity('city');
  try {
    // Act
    for (let i=0;i<900;i++) traffic.update(1/60,i/60,{x:0,y:1,z:0},0,false);
    // Assert
    expect(traffic.agents.length).toBeGreaterThan(80); expect(traffic.agents.length).toBeLessThanOrEqual(144);
    const lanes = new Set(traffic.agents.map(a => Math.round((a.point.z-world.edges[a.edge].points[0].z)*10)));
    expect(lanes.size).toBeGreaterThan(1);
    expect(scene.materials.length).toBeLessThan(60);
    const camera = new FreeCamera('verification', new Vector3(250, 350, -500), scene); camera.setTarget(new Vector3(250,0,0)); scene.activeCamera = camera; scene.render();
    expect(scene.getActiveMeshes().length).toBeGreaterThan(500);
    // Act — смена качества убирает дальние лишние машины, сохраняя поток рядом.
    traffic.setMobile(true);traffic.update(1/60,16,{x:0,y:1,z:0},0,false);
    // Assert
    expect(traffic.agents.length).toBeGreaterThan(0);expect(traffic.agents.length).toBeLessThanOrEqual(36);
  } finally { traffic.dispose(); scene.dispose(); engine.dispose(); }
}, 20000);
