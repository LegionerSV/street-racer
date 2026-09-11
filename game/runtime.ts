import {opponentMarkers,raceMarkerPosition} from './race-map-markers';
import {mapDiagnostics} from './map-diagnostics';
import {
  Color3, Color4, Engine, Scene, Vector3, FreeCamera,
  Mesh, MeshBuilder, VertexData, StandardMaterial, PhysicsAggregate, PhysicsShapeType, PhysicsMotionType, HavokPlugin,
  GlowLayer, PointLight, Ray, TransformNode, EngineInstrumentation, SceneInstrumentation, BoundingBox, Frustum,
} from '@babylonjs/core';
import HavokPhysics from '@babylonjs/havok';
import havokWasm from '@babylonjs/havok/lib/esm/HavokPhysics.wasm?url';
import type { ChunkData, HUD, MeshData, Point, RaceState, Route, Settings, World, RegionData } from './types';
import { WorldWorker } from './worker-client';
import { desiredChunks,criticalChunks } from './chunks';
import { distance2, pathLengths, projectOnSegment, tileKey } from './geo';
import { PlayerCar } from './vehicle';
import { DrivingInput,drivingKeys,type DrivingKey } from './input';
import { Traffic } from './traffic';
import { laneCaption } from './lanes';
import { drivingEdgeAt } from './road-position';
import { advanceRace, makeRace, playerProgress, signalPhase } from './simulation';
import { material } from './visuals';
import { EngineSound } from './audio';
import { Atmosphere } from './atmosphere';
import { indexWorld } from './chunks';
import {isLightQuality,resolutionScale} from './quality';
import { streetMaterials } from './street-materials';
import { FrameTimings } from './performance';
import { VehicleLighting } from './vehicle-lighting';
import { worldLandmarks } from './landmarks';
import {advanceDrivingPhysics,ChasePosition} from './driving-frame';
import type {LoadingLog} from './loading-log';
import {RegionStream,tileReady} from './region-stream';
import {edgeKey,changedChunks} from './world-update';
import {routeHasCoverage,needsRaceRecovery} from './stream-coverage';
import {edgeById,edgeStableId} from './road-graph';
import {nextRaceTurn} from './navigation';

type BreakableLoaded = { mesh: Mesh; pole: boolean; broken: boolean; lamp?: Point; body?: PhysicsAggregate };
type Loaded = { lod: number; meshes: Mesh[]; bodies: PhysicsAggregate[]; breakables: BreakableLoaded[]; lamps: Point[]; buildingBounds:BoundingBox[]; dispose: () => void };
export class Game {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly player: PlayerCar;
  readonly traffic: Traffic;
  readonly camera: FreeCamera;
  private chunks = new Map<string, Loaded>();
  private pending = new Set<string>();
  private wanted: ReturnType<typeof desiredChunks> = [];
  private materials: Record<string, StandardMaterial>;
  private atmosphere: Atmosphere;
  private facadeMaterials:StandardMaterial[];
  private vehicleLighting:VehicleLighting;
  private engineStats:EngineInstrumentation;
  private sceneStats:SceneInstrumentation;
  private frameTimings=new FrameTimings();
  private installTimings=new FrameTimings(120);
  private odometer = 0;
  private lookTarget = Vector3.Zero();
  private cameraForward = Vector3.Forward();
  private chasePosition=new ChasePosition();
  private input=new DrivingInput();
  private keys=this.input.keys;
  private disposed = false;
  private running = false;
  private time = 0;
  private activeWallSeconds = 0;
  private streamClock = 0;
  private hudClock = 0;
  private previous = Vector3.Zero();
  private loading = true;
  private preparingRace=false;
  private message = '';
  private signalMeshes = new Map<number, { node: TransformNode; lamps: Mesh[][] }>();
  private signalMaterials: StandardMaterial[];
  private lampLights: PointLight[] = [];
  private sound = new EngineSound();
  private markers: { route: Route; mesh: Mesh; symbol: Mesh }[] = [];
  private checkpoint: Mesh;
  private checkpointGlow: Mesh;
  private glow: GlowLayer | null;
  private nitroJets:Mesh[]=[];
  private streamFailure: string | null = null;
  private mapStream?:RegionStream;
  private mapCoverage?:Set<string>;
  private suspendPump=false;
  private applyingMap=false;
  private staleChunks=new Set<string>();
  private mapUpdateTimings:{fetchMs:number;buildWorldMs:number;commitMs:number;totalMs:number;tiles:number}[]=[];
  private streamingControl=new AbortController();
  paused = false;
  race: RaceState | null = null;
  nearRace: Route | null = null;
  private lastSafeEdge: string | null;
  private routeLengths = new Map<number, number[]>();
  private driveTest: { route: Route; target: number; elapsed: number; distance: number; last: Point; frames: number[]; maxMeshes: number; maxSpeed: number; samples: number[] } | null = null;
  private testReport: Record<string, unknown> | null = null;
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (drivingKeys.has(e.code)) { e.preventDefault(); this.sound.resume(); if(!this.paused&&!this.loading)this.input.press('key:'+e.code,e.code as DrivingKey); }
    if (!e.repeat) {
      if (e.code === 'Escape') this.togglePause();
      if (e.code === 'KeyR' && !this.paused) this.recover();
      if (e.code === 'KeyE' && !this.paused) { if (this.race?.phase === 'finished') this.finishRace(); else if (this.nearRace && !this.race) void this.startRace(this.nearRace); }
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent) => this.input.release('key:'+e.code);
  private readonly onBlur = () => { this.clearControls(); if (this.running) { this.paused = true; this.emit(); } };
  private readonly resize = () => {this.engine.setHardwareScalingLevel(resolutionScale(this.settings.quality,this.canvas.clientWidth,this.canvas.clientHeight));this.engine.resize();};
  private readonly onVisibility = () => { if (document.hidden) this.onBlur(); };
  static async create(canvas: HTMLCanvasElement, world: World, worker: WorldWorker, settings: Settings, onHUD: (hud: HUD) => void, progress: (text: string, n: number) => void, signal: AbortSignal,log?:LoadingLog) {
    signal.throwIfAborted();
    progress('Загружаем физику автомобиля',85);
    const loadHavok=()=>HavokPhysics({locateFile:()=>havokWasm});
    const havok = await (log?log.measure('Загрузка и запуск Havok',loadHavok):loadHavok()); signal.throwIfAborted();
    const createScene=()=>new Game(canvas,world,worker,settings,onHUD,havok);
    const game = await (log?log.measure('Создание игровой сцены',createScene):createScene());
    const abort = () => game.dispose(); signal.addEventListener('abort', abort, { once: true });
    try {
      const spawn = world.spawnEdge ? edgeById(world, world.spawnEdge) : undefined; if (!spawn) throw new Error('В этом участке нет дорог для машины. Выберите другой район.');
      game.player.reset(spawn, world.drivingSide);
      game.refreshWanted();
      const critical=new Set(criticalChunks(game.player.position,game.player.heading,!!world.loadedTiles));
      const first = game.wanted.filter(c => critical.has(c.key) && c.lod === 0);
      for (let i = 0; i < first.length; i++) {
        signal.throwIfAborted();
        const prepare=()=>worker.chunk(first[i].key,0,settings.quality==='mobile'?8:32);
        const chunk=await(log?log.measure('Стартовый квартал / подготовка',prepare,{key:first[i].key}):prepare());signal.throwIfAborted();
        if(log)await log.measure('Стартовый квартал / установка',()=>game.install(chunk),{key:chunk.key});else game.install(chunk);
        progress(`Готовим улицы рядом с машиной · ${i + 1}/${first.length}`, 87 + (i + 1) / first.length * 12);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      game.loading = false; game.running = true; game.scene.physicsEnabled = true; game.sound.start();
      game.engine.runRenderLoop(() => game.frame()); canvas.focus(); game.emit();
      return game;
    } catch (error) { game.dispose(); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
  private constructor(private canvas: HTMLCanvasElement, public world: World, private worker: WorldWorker, public settings: Settings, private onHUD: (hud: HUD) => void, havok: unknown) {
    this.mapCoverage=world.loadedTiles?new Set(world.loadedTiles):undefined;
    this.engine = new Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    this.engine.setHardwareScalingLevel(resolutionScale(settings.quality,canvas.clientWidth,canvas.clientHeight));
    this.scene = new Scene(this.engine); this.scene.clearColor = new Color4(.105, .15, .2, 1);
    this.engineStats=new EngineInstrumentation(this.engine);this.engineStats.captureGPUFrameTime=true;
    this.sceneStats=new SceneInstrumentation(this.scene);
    // После фонового ограничения браузера не выполняем секунду физики за один кадр.
    Scene.MaxDeltaTime = 100;
    this.scene.fogMode = Scene.FOGMODE_EXP2; this.scene.fogDensity = settings.quality === 'high' ? .00095 : .00135; this.scene.fogColor = new Color3(.13, .2, .24);
    this.scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(true, havok));
    this.scene.getPhysicsEngine()!.setTimeStep(1 / 60); this.scene.getPhysicsEngine()!.setSubTimeStep(1000 / 60); this.scene.physicsEnabled = false;
    this.camera = new FreeCamera('chase-camera', Vector3.Zero(), this.scene); this.camera.minZ = .5; this.camera.maxZ = 2300; this.camera.fov = .86; this.camera.inputs.clear();
    this.player = new PlayerCar(this.scene); this.traffic = new Traffic(this.scene, world); this.traffic.setDensity(settings.traffic || 'city');this.traffic.setMobile(settings.quality==='mobile'); this.lastSafeEdge = world.spawnEdge;
    this.materials = {
      shoulders: material(this.scene, 'shoulders', '#ffffff'), terrain: material(this.scene, 'terrain', '#ffffff'), road: material(this.scene, 'road', '#ffffff'), markings: material(this.scene, 'markings', '#ffffff'),
      structures: material(this.scene, 'structures', '#ffffff'), buildings: material(this.scene, 'buildings', '#ffffff'), windows: material(this.scene, 'windows', '#ffffff', true),
      water: material(this.scene, 'water', '#326b80'), tree: material(this.scene, 'foliage', '#214238'), trunk: material(this.scene, 'trunk', '#3b3c34'),
    };
    const street=streetMaterials(this.scene);this.facadeMaterials=street.facades;this.materials.sidewalks=street.sidewalks;this.materials.landmarks=this.materials.structures;
    this.facadeMaterials.forEach((m,i)=>this.materials['facade'+i]=m);
    Object.values(this.materials).forEach(m => { m.backFaceCulling = false; m.twoSidedLighting=true; m.maxSimultaneousLights = 8; });
    this.materials.terrain.emissiveColor = new Color3(.025, .03, .035);
    this.materials.road.emissiveColor = new Color3(.015, .018, .025);
    this.materials.buildings.emissiveColor = new Color3(.035, .04, .05);
    this.materials.structures.emissiveColor = new Color3(.08, .1, .12);
    this.materials.markings.emissiveColor = new Color3(.2, .2, .18);
    this.materials.windows.zOffset = -2;
    this.materials.road.specularColor = new Color3(.22, .28, .31); this.materials.road.specularPower = 48;
    this.materials.water.specularColor = new Color3(.8, .85, .9); this.materials.water.specularPower = 80; this.materials.water.emissiveColor = new Color3(.035, .12, .16);
    this.atmosphere = new Atmosphere(this.scene, this.camera, this.materials, settings.quality);
    this.glow = null; this.configureGlow(settings.quality);
    this.signalMaterials = [material(this.scene, 'red-on', '#ff4938', true), material(this.scene, 'yellow-on', '#ffca57', true), material(this.scene, 'green-on', '#80efb2', true), material(this.scene, 'signal-off', '#15212a')];
    for (let i = 0; i < 4; i++) { const light = new PointLight(`streetlight-${i}`, Vector3.Zero(), this.scene); light.diffuse = new Color3(1, .78, .45); light.range = 20; light.intensity = 0; this.lampLights.push(light); }
    this.vehicleLighting=new VehicleLighting(this.scene);
    const nitroMat=material(this.scene,'nitro-flame','#6eefff',true);
    for(const x of [-.57,.57]){
      const jet=MeshBuilder.CreateCylinder('player-nitro-jet',{height:.9,diameterTop:0,diameterBottom:.21,tessellation:8},this.scene);
      jet.parent=this.player.visual.root;jet.position.set(x,-.23,-2.6);jet.rotation.x=-Math.PI/2;jet.material=nitroMat;jet.isPickable=false;jet.setEnabled(false);this.nitroJets.push(jet);
    }
    const markerMat = material(this.scene, 'race-marker', '#d8ff3e', true); markerMat.alpha = .35;
    world.routes.forEach(route => {
      const sample={point:raceMarkerPosition(world,route)};
      const mesh = MeshBuilder.CreateCylinder(`marker-${route.kind}`, { diameter: 8, height: .12, tessellation: 40 }, this.scene); mesh.position.set(sample.point.x, sample.point.y + .12, sample.point.z); mesh.material = markerMat; mesh.isPickable = false;
      const symbol = MeshBuilder.CreateTorus('marker-symbol', { diameter: 3.2, thickness: .09, tessellation: 30 }, this.scene); symbol.rotation.x = Math.PI / 2; symbol.position.copyFrom(mesh.position).addInPlace(new Vector3(0, 3, 0)); symbol.material = markerMat; symbol.isPickable = false;
      this.markers.push({ route, mesh, symbol });
    });
    this.checkpoint = MeshBuilder.CreateTorus('checkpoint', { diameter: 10, thickness: .12, tessellation: 40 }, this.scene); this.checkpoint.material = markerMat; this.checkpoint.isPickable = false; this.checkpoint.setEnabled(false);
    this.checkpointGlow = MeshBuilder.CreateCylinder('checkpoint-base', { diameter: 10, height: .07, tessellation: 32 }, this.scene); this.checkpointGlow.material = markerMat; this.checkpointGlow.isPickable = false; this.checkpointGlow.setEnabled(false);
    window.addEventListener('keydown', this.onKeyDown); window.addEventListener('keyup', this.onKeyUp); window.addEventListener('blur', this.onBlur); window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.scene.onBeforePhysicsObservable.add(() => {
      if (this.paused || this.loading) return;
      const dt = 1 / 60; this.time += dt; this.previous.copyFrom(this.player.position);
      this.player.wetness = this.atmosphere.state.wetness; this.traffic.wetness = this.atmosphere.state.wetness;
      const near = indexWorld(this.world).segments.get(tileKey(this.player.position.x,this.player.position.z)) || [];
      this.player.offRoad = !near.some(s => { const p=projectOnSegment(this.player.position,s.a,s.b);return p.distance<s.edge.width/2+1.3&&Math.abs(p.point.y-this.player.position.y)<2; });
      if (this.driveTest) this.testStep(dt);
      this.player.step(dt, this.keys, this.race?.phase === 'countdown');
      this.traffic.update(dt, this.time, this.player.position, this.player.speed, !!this.race && this.race.phase !== 'countdown', this.race?.elapsed || 0);
    });
    this.scene.onAfterPhysicsObservable.add(() => {
      this.player.afterPhysics(); if (this.paused || this.loading) return;
      this.odometer += distance2(this.previous,this.player.position);
      if (this.race) {
        advanceRace(this.race, this.player.position, 1 / 60, this.previous);
        const own = playerProgress(this.race, this.player.position);
        this.race.position = 1 + this.traffic.racers.filter(a => this.race!.phase === 'finished' ? a.race!.finished && (a.race!.finishTime ?? Infinity) < this.race!.finishTime! : a.race!.finished || a.race!.progress > own).length;
      }
    });
  }
  private makeMesh(name: string, data: MeshData, mat: StandardMaterial) {
    if (!data.positions.length || !data.indices.length) return null;
    const mesh = new Mesh(name, this.scene), vertices = new VertexData(), normals: number[] = [];
    vertices.positions = data.positions; vertices.indices = data.indices; VertexData.ComputeNormals(data.positions, data.indices, normals); vertices.normals = normals;
    if (data.colors?.length === data.positions.length / 3 * 4) vertices.colors = data.colors;
    vertices.uvs = data.uvs?.length===data.positions.length/3*2?data.uvs:[];
    if(!vertices.uvs.length)for (let i=0;i<data.positions.length;i+=3) vertices.uvs.push(data.positions[i] * .5, data.positions[i+2] * .5);
    vertices.applyToMesh(mesh); mesh.material = mat; mesh.receiveShadows = true; mesh.freezeWorldMatrix(); mesh.isPickable = false; return mesh;
  }
  private install(chunk: ChunkData) {
    if (this.disposed) return;
    const started=performance.now();
    const meshes: Mesh[] = [], bodies: PhysicsAggregate[] = [], breakables:BreakableLoaded[]=[],lamps=[...chunk.lamps];
    const surfaces:[string,MeshData|undefined,StandardMaterial][]=['terrain','shoulders','sidewalks','road','markings','structures','treeTrunks','buildings','landmarks','windows','water'].map(role=>[role,chunk[role as keyof ChunkData] as MeshData|undefined,this.materials[role]||this.materials.trunk]);
    chunk.facades?.forEach((data,i)=>surfaces.push(['facade'+i,data,this.facadeMaterials[i]]));
    for (const [role,data,mat] of surfaces) {
      if(!data)continue;
      const mesh = this.makeMesh(`${chunk.key}:${role}`, data, mat); if (!mesh) continue;
      if(role==='treeTrunks'){mesh.isVisible=false;mesh.receiveShadows=false;}
      meshes.push(mesh);
      if (chunk.lod === 0 && (['terrain', 'shoulders', 'sidewalks', 'road', 'structures', 'treeTrunks', 'buildings', 'landmarks'].includes(role)||role.startsWith('facade'))) {
        mesh.isPickable = role === 'structures' || role === 'buildings'||role==='landmarks'||role.startsWith('facade');
        bodies.push(new PhysicsAggregate(mesh, PhysicsShapeType.MESH, { mass: 0, friction: .65, restitution: .02 }, this.scene));
      }
    }
    for(const [i,prop] of chunk.breakables.entries()){
      const pole=prop.kind==='pole',mesh=pole
        ?MeshBuilder.CreateCylinder(`${chunk.key}:breakable-pole-${i}`,{height:7,diameter:.16,tessellation:6},this.scene)
        :MeshBuilder.CreateBox(`${chunk.key}:breakable-fence-${i}`,{width:.14,height:1.05,depth:prop.length||2},this.scene);
      mesh.position.copyFromFloats(prop.point.x,prop.point.y+(pole?3.5:.525),prop.point.z);mesh.rotation.y=prop.heading;mesh.material=this.materials.structures;mesh.isPickable=false;
      if(pole){const head=MeshBuilder.CreateBox('streetlight-head',{width:.7,height:.14,depth:1.4},this.scene);head.parent=mesh;head.position.set(0,3.45,0);head.material=this.materials.windows;head.isPickable=false;}
      const lamp=pole?lamps.find(p=>p.x===prop.point.x&&p.z===prop.point.z):undefined;
      meshes.push(mesh);breakables.push({mesh,pole,broken:false,lamp});
    }
    if (chunk.trees.length) {
      const trunk = MeshBuilder.CreateCylinder(`${chunk.key}:trunks`, { diameter: .55, height: 7, tessellation: 5 }, this.scene); trunk.material = this.materials.trunk;
      const foliage = MeshBuilder.CreateSphere(`${chunk.key}:foliage`, { diameter: 9, segments: 3 }, this.scene); foliage.material = this.materials.tree;
      const matrices = new Float32Array(chunk.trees.length * 16), leaves = new Float32Array(matrices.length);
      chunk.trees.forEach((p, i) => { const base = i * 16; matrices[base] = matrices[base + 5] = matrices[base + 10] = matrices[base + 15] = 1; matrices[base + 12] = p.x; matrices[base + 13] = p.y + 3.5; matrices[base + 14] = p.z; leaves.set(matrices.subarray(base, base + 16), base); leaves[base + 13] = p.y + 8.5; });
      trunk.thinInstanceSetBuffer('matrix', matrices, 16); foliage.thinInstanceSetBuffer('matrix', leaves, 16); trunk.isPickable = foliage.isPickable = false; meshes.push(trunk, foliage);
    }
    this.chunks.get(chunk.key)?.dispose();
    const buildingBounds=(indexWorld(this.world).buildings.get(chunk.key)||[]).map(b=>new BoundingBox(new Vector3(Math.min(...b.footprint.map(p=>p.x)),Math.min(...b.footprint.map(p=>p.y))+(b.minHeight||0),Math.min(...b.footprint.map(p=>p.z))),new Vector3(Math.max(...b.footprint.map(p=>p.x)),Math.max(...b.footprint.map(p=>p.y))+b.height,Math.max(...b.footprint.map(p=>p.z)))));
    this.chunks.set(chunk.key, { lod: chunk.lod, meshes, bodies, breakables, lamps, buildingBounds, dispose: () => { breakables.forEach(p=>p.body?.dispose()); bodies.forEach(b => b.dispose()); meshes.forEach(m => m.dispose()); } });
    this.installTimings.add(performance.now()-started);
    this.staleChunks.delete(chunk.key);
  }
  private refreshWanted() {
    this.wanted = desiredChunks(this.player.position, this.player.heading, this.settings.quality,!!this.mapCoverage).filter(c=>!this.mapCoverage||tileReady(this.mapCoverage,c.key,this.world.center));
    const wanted = new Set(this.wanted.map(c => c.key));
    for (const [key, chunk] of this.chunks) if (!wanted.has(key)) { chunk.dispose(); this.chunks.delete(key); this.staleChunks.delete(key); }
  }
  private pump() {
    if (this.disposed || this.suspendPump || this.streamFailure || this.pending.size >= 2) return;
    const next = this.wanted.find(c => !this.pending.has(c.key) && (this.chunks.get(c.key)?.lod !== c.lod||this.staleChunks.has(c.key)));
    if (!next) return;
    this.pending.add(next.key);
    void this.worker.chunk(next.key, next.lod,this.settings.quality==='mobile'?8:32).then(chunk => {
      if (!this.disposed && this.wanted.some(c => c.key === chunk.key && c.lod === chunk.lod)) this.install(chunk);
    }).catch(e => { if (!this.disposed) { this.streamFailure = e instanceof Error ? e.message : 'Не удалось подготовить квартал.'; this.message = this.streamFailure; this.paused = true; this.clearControls(); } }).finally(() => this.pending.delete(next.key));
  }
  private updateSignals() {
    const close = this.world.nodes.filter(n => n.signal && distance2(n, this.player.position) < (this.settings.quality==='mobile'?300:500)), keep = new Set(close.map(n => n.id));
    for (const [id, item] of this.signalMeshes) if (!keep.has(id)) { item.node.dispose(); this.signalMeshes.delete(id); }
    for (const n of close) {
      let item = this.signalMeshes.get(n.id);
      if (!item) {
        const root = new TransformNode(`signal-${n.id}`, this.scene); root.position.set(n.x, n.y, n.z); const lamps: Mesh[][] = [];
        for (let axis = 0; axis < 2; axis++) {
          const pole = MeshBuilder.CreateCylinder('signal-pole', { height: 4.6, diameter: .12, tessellation: 6 }, this.scene); pole.parent = root; const nearby=indexWorld(this.world).segments.get(tileKey(n.x,n.z))||[];
          const approach=nearby.find(s=>s.edge.to===n.id&&((Math.abs(s.b.x-s.a.x)>Math.abs(s.b.z-s.a.z)?1:0)===axis));
          const heading=approach?Math.atan2(approach.b.x-approach.a.x,approach.b.z-approach.a.z):axis*Math.PI/2;
          let safe:Point|undefined;
          for(const back of [10,16,24])for(const side of [1,-1]){const width=(approach?.edge.width||10)/2+2;const p={x:n.x-Math.sin(heading)*back+Math.cos(heading)*width*side,y:n.y,z:n.z-Math.cos(heading)*back-Math.sin(heading)*width*side};if(!safe&&nearby.every(s=>Math.abs(s.a.y-p.y)>3||projectOnSegment(p,s.a,s.b).distance>s.edge.width/2+.7))safe=p;}
          if(!safe){pole.dispose();lamps.push([]);continue;}
          pole.position.set(safe.x-n.x,2.3,safe.z-n.z); pole.material = this.materials.structures; pole.isPickable = false;
          const head = MeshBuilder.CreateBox('signal-box', { width: .55, height: 1.5, depth: .35 }, this.scene); head.parent = root; head.position.set(pole.position.x, 4.2, pole.position.z); head.material = this.signalMaterials[3]; head.isPickable = false;
          const lights: Mesh[] = [];
          for (let k = 0; k < 3; k++) { const bulb = MeshBuilder.CreateSphere('signal-bulb', { diameter: .28, segments: 6 }, this.scene); bulb.parent = root; bulb.position.set(pole.position.x, 4.7 - k * .45, pole.position.z - .19); bulb.material = this.signalMaterials[3]; bulb.isPickable = false; lights.push(bulb); }
          lamps.push(lights);
        }
        item = { node: root, lamps }; this.signalMeshes.set(n.id, item);
      }
      for (let axis = 0; axis < 2; axis++) { const phase = signalPhase(this.time, axis), active = phase === 'red' ? 0 : phase === 'yellow' ? 1 : 2; item.lamps[axis].forEach((lamp, i) => lamp.material = this.signalMaterials[i === active ? i : 3]); }
    }
  }
  private updateBreakables() {
    const activateDistance=70*70,deactivateDistance=95*95;
    for(const chunk of this.chunks.values())for(const prop of chunk.breakables){
      const distance=Vector3.DistanceSquared(prop.mesh.position,this.player.position);
      if(!prop.body&&distance<activateDistance){
        const body=new PhysicsAggregate(prop.mesh,PhysicsShapeType.BOX,{mass:prop.pole?28:18,friction:.5,restitution:.08},this.scene);
        prop.body=body;body.body.setMotionType(PhysicsMotionType.STATIC);body.body.setCollisionCallbackEnabled(true);
        body.body.getCollisionObservable().add(event=>{
          if(prop.broken||event.impulse<(prop.pole?500:320))return;
          prop.broken=true;body.body.setMotionType(PhysicsMotionType.DYNAMIC);
          if(prop.lamp){const i=chunk.lamps.indexOf(prop.lamp);if(i>=0)chunk.lamps.splice(i,1);}
          const velocity=event.collidedAgainst.getLinearVelocity();body.body.setLinearVelocity(velocity.scale(.7).add(new Vector3(0,1.2,0)));body.body.setAngularVelocity(new Vector3(velocity.z*.12,0,-velocity.x*.12));
        });
      }else if(prop.body&&!prop.broken&&distance>deactivateDistance){prop.body.dispose();prop.body=undefined;}
    }
  }
  private frame() {
    if (this.disposed) return;
    if(!this.paused&&!document.hidden)this.frameTimings.add(this.engine.getDeltaTime(),this.loading||this.pending.size>0);
    const dt = Math.min(.25, this.engine.getDeltaTime() / 1000);
    if (this.driveTest && !this.paused) { this.driveTest.frames.push(this.engine.getDeltaTime()); this.driveTest.maxMeshes = Math.max(this.driveTest.maxMeshes, this.scene.meshes.length); this.driveTest.maxSpeed = Math.max(this.driveTest.maxSpeed, this.player.groundSpeed * 3.6); }
    this.streamClock -= dt; this.hudClock -= dt;
    if (this.streamClock <= 0) {
      this.streamClock = .5; this.refreshWanted(); this.updateSignals(); this.updateBreakables();
      const lamps = [...this.chunks.values()].flatMap(c => c.lamps).sort((a, b) => distance2(a, this.player.position) - distance2(b, this.player.position));
      this.lampLights.forEach((light, i) => { if (lamps[i] && !isLightQuality(this.settings.quality)) { light.position.copyFromFloats(lamps[i].x, lamps[i].y, lamps[i].z); light.intensity = 2 * (1-this.atmosphere.state.daylight); } else light.intensity = 0; });
      if (this.player.grounded && !this.race) {
        const nearest=drivingEdgeAt(this.world,this.player.position,this.player.heading);
        if(nearest)this.lastSafeEdge=edgeStableId(nearest);
      }
    }
    this.pump();
    const p = this.player.position, h = this.player.heading;
    const critical = this.recoverAtMapBoundary(criticalChunks(p,this.player.speed<0?h+Math.PI:h,!!this.mapCoverage));
    this.loading = this.preparingRace || this.applyingMap || critical.some(k => this.mapCoverage ? !tileReady(this.mapCoverage,k,this.world.center)||this.chunks.get(k)?.lod!==0||this.staleChunks.has(k) : this.wanted.some(c => c.key === k) && this.chunks.get(k)?.lod !== 0);
    if(this.loading)this.clearControls();
    advanceDrivingPhysics(this.scene,this.engine.getDeltaTime(),!this.paused&&!this.loading);
    if ((!this.mapCoverage&&(Math.abs(p.x) > 2495 || Math.abs(p.z) > 2495)) || p.y < -200 || p.y > 10000) this.recover();
    const bodyForward = this.player.visual.root.getDirection(Vector3.Forward());bodyForward.y=0;bodyForward.normalize();
    if(this.camera.position.lengthSquared()<1||Vector3.Distance(this.camera.position,p)>25)this.cameraForward.copyFrom(bodyForward);
    else Vector3.LerpToRef(this.cameraForward,bodyForward,1-Math.exp(-dt*8),this.cameraForward);
    const forward=this.cameraForward.normalize(),target=p.add(new Vector3(0,.55,0));
    const desired=p.subtract(forward.scale(6.6+Math.min(.7,this.player.groundSpeed*.012))).add(new Vector3(0,1.85,0));
    const cameraRay = new Ray(target, desired.subtract(target).normalize(), Vector3.Distance(target, desired));
    const collision = this.scene.pickWithRay(cameraRay, mesh => mesh.isPickable);
    if (collision?.hit && collision.pickedPoint) desired.copyFrom(collision.pickedPoint.add(cameraRay.direction.scale(-.45)));
    const look=target.add(forward.scale(3));
    this.chasePosition.update(p,desired,look,this.camera.position,this.lookTarget,dt,!!collision?.hit);
    this.camera.setTarget(this.lookTarget);this.camera.fov+=(.94+Math.min(.14,this.player.groundSpeed*.002)+(this.player.nitro.active?.06:0)-this.camera.fov)*(1-Math.exp(-dt*7));
    this.nitroJets.forEach((jet,i)=>{jet.setEnabled(this.player.nitro.active&&!this.paused&&!this.loading);jet.scaling.y=.9+.12*Math.sin(this.time*40+i);});
    this.atmosphere.update(this.time,this.paused||this.loading?0:dt,p,this.settings,this.settings.quality);
    this.vehicleLighting.update(dt,this.player.visual,this.traffic.agents.flatMap(a=>a.visual?[a.visual]:[]),this.settings.quality,this.atmosphere.state.daylight);
    const sheltered=(indexWorld(this.world).segments.get(tileKey(p.x,p.z))||[]).some(s=>s.edge.tunnel&&projectOnSegment(p,s.a,s.b).distance<s.edge.width/2+1&&Math.abs(projectOnSegment(p,s.a,s.b).point.y-p.y)<3);
    this.scene.getMeshByName('rain')?.setEnabled(!sheltered&&this.atmosphere.state.rain>.02);
    this.nearRace = null;
    let nearRaceDistance=22;
    for (const marker of this.markers) {
      marker.mesh.setEnabled(!this.race); marker.symbol.setEnabled(!this.race); marker.symbol.rotation.y += dt * .5;
      const distance=distance2(p,marker.mesh.position);
      if (!this.race && distance<nearRaceDistance && Math.abs(p.y - marker.mesh.position.y) < 4){this.nearRace = marker.route;nearRaceDistance=distance;}
    }
    const checkpointVisible = !!this.race && this.race.phase !== 'finished';
    this.checkpoint.setEnabled(checkpointVisible); this.checkpointGlow.setEnabled(checkpointVisible);
    if (checkpointVisible && this.race) {
      const point = this.race.route.points[this.race.checkpoint], previous = this.race.route.points[this.race.checkpoint - 1];
      this.checkpoint.position.set(point.x, point.y + 4, point.z); this.checkpoint.rotation.set(Math.PI / 2, Math.atan2(point.x - previous.x, point.z - previous.z), 0);
      this.checkpointGlow.position.set(point.x, point.y + .2, point.z);
    }
    this.sound.update(this.player.speed, this.keys.has('KeyW') || this.keys.has('ArrowUp') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'), this.settings.volume, this.paused || this.loading);
    if(!this.paused&&!this.loading)this.activeWallSeconds+=this.engine.getDeltaTime()/1000;
    this.scene.render();
    if (this.hudClock <= 0) { this.hudClock = .1; this.emit(); }
  }
  private emit() {
    const safeEdge=this.lastSafeEdge?edgeById(this.world,this.lastSafeEdge):undefined;
    this.onHUD({ opponents:this.race?opponentMarkers(this.traffic.racers):[], speed: this.player.groundSpeed * 3.6, gear: this.player.speed < -1 ? 'R' : String(Math.max(1, Math.min(6, Math.floor(Math.abs(this.player.speed) / 10) + 1))), fps: Math.round(this.engine.getFps()), position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z }, heading: this.player.heading, paused: this.paused, loading: this.loading, mapStatus: this.preparingRace?'Прокладываем маршрут по загруженной карте…':this.mapStream?.status, race: this.race ? { ...this.race } : null, navigation:this.settings.navigator&&this.race?nextRaceTurn(this.race,this.player.position):null, nearRace: this.nearRace, message: this.message, chunks: this.chunks.size, vehicles: this.traffic.agents.filter(a => !!a.visual).length, street: safeEdge?.name, lanes: safeEdge ? laneCaption(safeEdge) : '', weather: this.atmosphere.state.label, hour: this.atmosphere.state.hour, wetness: this.atmosphere.state.wetness, slip: this.player.slip, odometer: this.odometer, nitro: this.player.nitro.charge, boosting: this.player.nitro.active&&!this.paused&&!this.loading });
  }
  private recoverAtMapBoundary(critical:string[]){
    if(!needsRaceRecovery(!!this.race||!!this.driveTest,this.mapCoverage,critical,this.world.center))return critical;
    if(this.driveTest)this.endDriveTest();
    this.recover();
    this.message='Впереди район ещё не загружен. Автомобиль возвращён на трассу.';
    return criticalChunks(this.player.position,this.player.heading,!!this.mapCoverage);
  }
  attachMapStream(stream:RegionStream,onWorld:(world:World)=>void){
    this.mapStream=stream;
    const wait=(ms:number)=>new Promise<void>(resolve=>{
      const signal=this.streamingControl.signal;
      const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
      const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});
      if(signal.aborted)finish();
    });
    const blocked=()=>this.preparingRace||!!this.race||!!this.driveTest||document.hidden;
    void (async()=>{
      let awaiting:RegionData|null=null;
      while(!this.disposed){
        if(blocked()){await wait(1000);continue;}
        try{
          const updateStarted=performance.now();
          const position=this.player.position;
          const region:RegionData|null=awaiting??await stream.next({x:position.x,y:position.y,z:position.z},this.player.heading,()=>({position:{x:this.player.position.x,y:this.player.position.y,z:this.player.position.z},heading:this.player.heading}));
          const fetchedAt=performance.now();
          if(this.disposed)return;
          if(!region){await wait(1500);continue;}
          awaiting=region;
          while(!this.disposed&&blocked())await wait(1000);
          if(this.disposed)return;
          const prepareStarted=performance.now();
          const next=await this.worker.prepare(region);
          const preparedAt=performance.now();
          while(!this.disposed&&blocked())await wait(1000);
          if(this.disposed)return;
          const nextCoverage=new Set(next.loadedTiles);
          if(criticalChunks(this.player.position,this.player.speed<0?this.player.heading+Math.PI:this.player.heading,true).some(k=>!tileReady(nextCoverage,k,this.world.center))){awaiting=null;continue;}
          this.suspendPump=true;
          while(!this.disposed&&this.pending.size)await wait(20);
          if(this.disposed)return;
          this.applyingMap=true;
          const commitStarted=performance.now();
          await this.worker.commit();
          const committedAt=performance.now();
          if(this.disposed)return;
          const newCoverage=new Set(next.loadedTiles);
          for(const key of changedChunks(this.world,next,this.chunks.keys()))this.staleChunks.add(key);
          const safe=this.lastSafeEdge?edgeById(this.world,this.lastSafeEdge):undefined;
          this.traffic.replaceWorld(next);
          this.world=next;this.mapCoverage=newCoverage;
          const matchedSafe=safe?next.edges.find(e=>!e.blocked&&edgeKey(e)===edgeKey(safe)):undefined;
          this.lastSafeEdge=matchedSafe?edgeStableId(matchedSafe):next.spawnEdge;
          this.replaceRouteMarkers();
          this.refreshWanted();onWorld(next);awaiting=null;
          this.mapUpdateTimings.push({fetchMs:Math.round(fetchedAt-updateStarted),buildWorldMs:Math.round(preparedAt-prepareStarted),commitMs:Math.round(committedAt-commitStarted),totalMs:Math.round(performance.now()-updateStarted),tiles:next.loadedTiles?.length??0});
          if(this.mapUpdateTimings.length>20)this.mapUpdateTimings.shift();
        }catch(error){
          if(this.disposed)return;
          this.message=error instanceof Error?error.message:'Не удалось подготовить следующий участок.';
          await wait(30000);
        }finally{this.suspendPump=false;this.applyingMap=false;}
        await wait(1000);
      }
    })();
  }
  private replaceRouteMarkers(){
    for(const marker of this.markers){marker.mesh.dispose();marker.symbol.dispose();}
    this.markers=[];this.nearRace=null;this.routeLengths.clear();
    this.world.routes.forEach(route=>{
      const sample={point:raceMarkerPosition(this.world,route)};
      const mesh=MeshBuilder.CreateCylinder(`marker-${route.kind}`,{diameter:8,height:.12,tessellation:40},this.scene);mesh.position.set(sample.point.x,sample.point.y+.12,sample.point.z);mesh.material=this.checkpoint.material;mesh.isPickable=false;
      const symbol=MeshBuilder.CreateTorus('marker-symbol',{diameter:3.2,thickness:.09,tessellation:30},this.scene);symbol.rotation.x=Math.PI/2;symbol.position.copyFrom(mesh.position).addInPlace(new Vector3(0,3,0));symbol.material=this.checkpoint.material;symbol.isPickable=false;
      this.markers.push({route,mesh,symbol});
    });
  }
  private clearControls(){this.input.clear();this.player.nitro.interrupt();}
  setTouchControl(pointerId:number,key:DrivingKey,down:boolean){
    if(down){this.sound.resume();if(this.running&&!this.paused&&!this.loading)this.input.press('touch:'+pointerId,key);}
    else this.input.release('touch:'+pointerId);
  }
  togglePause() { this.sound.resume(); this.paused = !this.paused; this.clearControls(); this.emit(); }
  retryStreaming() { this.streamFailure = null; this.message = ''; this.paused = false; this.refreshWanted(); }
  recover() {
    if (this.race?.phase === 'finished') this.finishRace();
    const id = this.race ? this.race.route.edges[Math.max(0, Math.min(this.race.route.edges.length - 1, Math.floor((this.race.checkpoint - 1) / this.race.route.points.length * this.race.route.edges.length)))] : this.lastSafeEdge;
    if (this.race) {
      const p = this.race.route.points[Math.max(0, this.race.checkpoint - 1)], next = this.race.route.points[this.race.checkpoint];
      this.player.teleport({ ...p, y: p.y + .88 }, Math.atan2(next.x - p.x, next.z - p.z));
    } else { const edge=id?edgeById(this.world,id):undefined;if(!edge){this.message='Поблизости пока нет загруженной дороги для возвращения.';return;}this.player.reset(edge,this.world.drivingSide); }
    this.clearControls(); this.refreshWanted(); this.streamClock = 0; this.camera.position.setAll(0);
  }
  async startRace(invitation: Route) {
    if (this.race || this.paused || this.suspendPump || this.preparingRace || this.loading) return;
    const start=edgeById(this.world,invitation.edges[0]);
    if(!start||start.blocked)return;
    this.preparingRace=true;this.loading=true;this.clearControls();this.emit();
    try {
      const route=await this.worker.raceRoute(edgeStableId(start),invitation.kind);
      if(this.disposed)return;
      if(this.paused)return;
      if(!route||!routeHasCoverage(route.points,this.world.loadedTiles,this.world.center,Math.max(120,...route.edges.map(id=>edgeById(this.world,id)!.width/2+110))))
        throw new Error('Для этого заезда пока не хватает связанных загруженных дорог. Попробуйте другой старт или дождитесь подгрузки карты.');
      this.race = makeRace(route);this.message='';this.player.reset(edgeById(this.world,route.edges[0])!, this.world.drivingSide, 2);
      this.traffic.startRace(route);this.refreshWanted();this.clearControls();
    }catch(error){if(!this.disposed){this.message=error instanceof Error?error.message:'Не удалось построить маршрут заезда.';this.paused=true;}}
    finally{this.preparingRace=false;if(!this.disposed)this.emit();}
  }
  finishRace() { this.race = null; this.traffic.clearRacers(); this.emit(); }
  private configureGlow(quality:Settings['quality']){
    if(isLightQuality(quality)){this.glow?.dispose();this.glow=null;return;}
    if(!this.glow){this.glow=new GlowLayer('lights-glow',this.scene,{blurKernelSize:32,mainTextureRatio:.35});this.glow.intensity=.32;}
  }
  setSettings(settings: Settings) { this.settings = settings; this.traffic.setDensity(settings.traffic || 'city');this.traffic.setMobile(settings.quality==='mobile'); this.engine.setHardwareScalingLevel(resolutionScale(settings.quality,this.canvas.clientWidth,this.canvas.clientHeight)); this.scene.fogDensity = settings.quality === 'high' ? .00095 : .00135; this.configureGlow(settings.quality); this.refreshWanted(); }
  performanceReport(){
    const memory=(performance as Performance & {memory?:{usedJSHeapSize:number}}).memory;
    const planes=Frustum.GetPlanes(this.camera.getTransformationMatrix()),bounds=[...this.chunks.values()].flatMap(c=>c.buildingBounds),gpu=this.engineStats.gpuFrameTimeCounter;
    return {...this.frameTimings.summary(),mainThreadHeapMiB:memory?Math.round(memory.usedJSHeapSize/1048576):null,quality:this.settings.quality,loadedBuildings:bounds.length,visibleBuildings:bounds.filter(b=>b.isInFrustum(planes)).length,activeMeshes:this.scene.getActiveMeshes().length,triangles:Math.round(this.scene.getActiveIndices()/3),drawCalls:this.sceneStats.drawCallsCounter.current,gpuFrameMs:gpu?.count&&gpu.current>0?gpu.current/1e6:null,chunkInstallP95Ms:this.installTimings.summary().p95FrameMs,physicsSurfaces:[...this.chunks.values()].reduce((sum,c)=>sum+c.bodies.length,0),resolution:{width:this.engine.getRenderWidth(),height:this.engine.getRenderHeight()}};
  }
  resetPerformance(){this.frameTimings.reset();this.installTimings.reset();}
  exportPerformance(){
    const data={recordedAt:new Date().toISOString(),center:this.world.center,settings:this.settings,device:navigator.userAgent,performance:this.performanceReport(),diagnostics:this.diagnostics(),map:mapDiagnostics(this.world,this.player.position),sceneChunks:{installed:[...this.chunks].map(([key,c])=>({key,lod:c.lod})),pending:[...this.pending]}};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='street-racer-performance.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  diagnostics() { return { streaming:this.mapStream?.diagnostics(), mapUpdates:this.mapUpdateTimings, performance:this.performanceReport(), simulationRate: this.activeWallSeconds>1 ? this.time/this.activeWallSeconds : 1, meshes: this.scene.meshes.length, chunks: this.chunks.size, pending: this.pending.size, fps: this.engine.getFps(), trafficCars: this.traffic.agents.filter(a => !a.race).length, weather: this.atmosphere.state, odometer: this.odometer, offRoad: this.player.offRoad, slip: this.player.slip, racers: this.traffic.racers.map(a => ({ id: a.id, speed: a.speed * 3.6, progress: a.race!.progress, point: a.point })), worldRoads: this.world.edges.length, worldBuildings: this.world.buildings.length, landmarkModels:worldLandmarks(this.world).map(m=>({id:m.asset.id,source:m.asset.source,license:m.asset.license})), worldBridges: this.world.edges.filter(e => e.bridge && !e.blocked).length, worldTunnels: this.world.edges.filter(e => e.tunnel && !e.blocked).length, routes: this.world.routes.map(r => ({ kind: r.kind, km: r.length / 1000 })), position: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z }, speed: this.player.groundSpeed * 3.6, grounded: this.player.grounded, race: this.race?.phase || null, racePosition: this.race?.position, loading: this.loading, error: this.streamFailure, test: this.driveTest ? { elapsed: this.driveTest.elapsed, distance: this.driveTest.distance } : this.testReport }; }
  startDriveTest() {
    if(this.suspendPump)return;
    if (this.driveTest) { this.endDriveTest(); return; }
    const route = this.world.routes.find(r => r.kind === 'sprint') || this.world.routes[0];
    if (!route) { this.message = 'Нет маршрута для испытания.'; return; }
    this.race = null; this.traffic.clearRacers(); this.player.reset(edgeById(this.world,route.edges[0])!, this.world.drivingSide, 2);
    this.paused = false; this.clearControls(); this.resetPerformance();this.testReport = null;
    this.driveTest = { route, target: 1, elapsed: 0, distance: 0, last: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z }, frames: [], maxMeshes: 0, maxSpeed: 0, samples: [] };
    this.refreshWanted();
  }
  private testStep(dt: number) {
    const test = this.driveTest!; test.elapsed += dt;
    test.distance += distance2(test.last, this.player.position); test.last = { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z };
    const points = test.route.points;
    while (test.target < points.length - 1 && distance2(points[test.target], this.player.position) < Math.max(14, Math.abs(this.player.speed) * .65)) test.target++;
    const target = points[test.target], heading = Math.atan2(target.x - this.player.position.x, target.z - this.player.position.z), angle = Math.atan2(Math.sin(heading - this.player.heading), Math.cos(heading - this.player.heading));
    const targetSpeed = Math.abs(angle) > .7 ? 8 : Math.abs(angle) > .3 ? 15 : 40;
    this.clearControls(); if (angle > .045) this.keys.add('KeyD'); if (angle < -.045) this.keys.add('KeyA');
    if (this.player.speed < targetSpeed) this.keys.add('KeyW'); else if (this.player.speed > targetSpeed + 3) this.keys.add('KeyS');
    if (test.elapsed >= 90 || (test.target === points.length - 1 && distance2(target, this.player.position) < 20)) this.endDriveTest();
  }
  private endDriveTest() {
    if (!this.driveTest) return;
    const test = this.driveTest, sorted = [...test.frames].sort((a, b) => a - b), total = test.frames.reduce((a, b) => a + b, 0);
    this.testReport = { performance:this.performanceReport(), elapsed: Math.round(test.elapsed), distanceMeters: Math.round(test.distance), maxSpeedKmh: Math.round(test.maxSpeed), averageFps: Math.round(test.frames.length / (total / 1000 || 1)), p95FrameMs: Math.round(sorted[Math.max(0,Math.ceil(sorted.length * .95)-1)] || 0), maxMeshes: test.maxMeshes, finalMeshes: this.scene.meshes.length, finalChunks: this.chunks.size, finalGrounded: this.player.grounded };
    this.driveTest = null; this.clearControls(); this.paused = true; this.emit();
  }
  visitStructure(kind: 'bridge' | 'tunnel') {
    if(this.suspendPump)return;
    const candidates = this.world.edges.filter(e => e[kind] && !e.blocked).sort((a, b) => b.length - a.length);
    if (!candidates.length) { this.message = 'В этом районе нет доступных сооружений этого типа.'; return; }
    this.driveTest = null; this.race = null; this.traffic.clearRacers(); const edge = candidates[0]; this.lastSafeEdge = edgeStableId(edge); this.player.reset(edge, this.world.drivingSide); this.paused = false; this.refreshWanted(); this.streamClock = 0; this.camera.position.setAll(0);
    const lengths = pathLengths(edge.points);
    const route: Route = { id: `test-${kind}`, kind: 'sprint', title: kind === 'bridge' ? 'Испытание моста' : 'Испытание тоннеля', edges: [edgeStableId(edge)], points: edge.points, cumulative: lengths, length: lengths.at(-1)!, laps: 1 };
    this.testReport = null;
    this.driveTest = { route, target: 1, elapsed: 0, distance: 0, last: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z }, frames: [], maxMeshes: 0, maxSpeed: 0, samples: [] };
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.running = false;
    this.streamingControl.abort();this.mapStream?.dispose();this.worker.dispose();
      window.removeEventListener('keydown', this.onKeyDown); window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('blur', this.onBlur); window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.engine.stopRenderLoop(); this.engineStats.dispose();this.sceneStats.dispose();this.clearControls(); this.vehicleLighting.dispose();this.atmosphere.dispose(); this.sound.dispose(); this.traffic.dispose(); this.player.dispose(); this.chunks.forEach(c => c.dispose()); this.chunks.clear(); this.scene.dispose(); this.engine.dispose();
  }
}
