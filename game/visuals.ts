import { Color3, Mesh, MeshBuilder, StandardMaterial, TransformNode, Matrix, VertexData, Scene, Material, AbstractMesh, PBRMaterial, RawCubeTexture, Constants, Texture } from '@babylonjs/core';
export function material(scene: Scene, name: string, colour: string, glow = false) {
  const mat = new StandardMaterial(name, scene); mat.diffuseColor = Color3.FromHexString(colour); mat.specularColor = new Color3(.18,.2,.22);
  if (glow) { mat.emissiveColor = mat.diffuseColor; mat.disableLighting = true; } return mat;
}
export function makeEnvironment(scene: Scene) {
  const size=64, faces:Uint8Array[]=[];
  for(let face=0;face<6;face++) {
    const data=new Uint8Array(size*size*4);
    for(let y=0;y<size;y++) for(let x=0;x<size;x++){
      const u=(x+.5)/size*2-1,v=(y+.5)/size*2-1;
      const d=face===0?[1,-v,-u]:face===1?[-1,-v,u]:face===2?[u,1,v]:face===3?[u,-1,-v]:face===4?[u,-v,1]:[-u,-v,-1];
      const h=d[1]/Math.hypot(...d), t=Math.max(0,h), ground=h<0;
      const rgb=ground?[.13,.16,.19]:[.62-t*.44,.68-t*.34,.72-t*.18];
      const stripe=Math.abs(h-.03)<.035?.16:0;
      for(let c=0;c<3;c++)data[(y*size+x)*4+c]=Math.min(255,(rgb[c]+stripe)*255);
      data[(y*size+x)*4+3]=255;
    }
    faces.push(data);
  }
  const texture=new RawCubeTexture(scene,faces,size,Constants.TEXTUREFORMAT_RGBA,Constants.TEXTURETYPE_UNSIGNED_BYTE,true,false,Texture.TRILINEAR_SAMPLINGMODE);
  texture.name='procedural-sky-reflections'; texture.coordinatesMode=Texture.CUBIC_MODE; scene.environmentTexture=texture; scene.environmentIntensity=.8;
  return texture;
}
export type CarVisual = { root: Mesh; wheels: TransformNode[]; lamps: AbstractMesh[]; brakeLights: AbstractMesh[]; indicators: [AbstractMesh[],AbstractMesh[]]; materials: Material[]; dispose: () => void };
export function setCarLights(car: CarVisual, braking: boolean, turn: number, time: number) {
  car.brakeLights.forEach(m=>m.isVisible=braking);
  car.indicators.forEach((side,i)=>side.forEach(m=>m.isVisible=turn===(i===0?-1:1)&&time% .8<.4));
}
export type CarKind='sport'|'sedan'|'hatch'|'suv'|'van';
const carShapes={
  sport:{length:4.34,belt:.24,roof:.78,rear:-1.18,roofRear:-.67,front:.85,roofFront:.21},
  sedan:{length:4.68,belt:.36,roof:.98,rear:-1.28,roofRear:-.81,front:.87,roofFront:.27},
  hatch:{length:3.95,belt:.32,roof:1.07,rear:-1.83,roofRear:-1.5,front:.77,roofFront:.2},
  suv:{length:4.57,belt:.48,roof:1.29,rear:-1.8,roofRear:-1.48,front:.95,roofFront:.4},
  van:{length:4.92,belt:.48,roof:1.7,rear:-2,roofRear:-1.96,front:1.25,roofFront:.92},
};
export function createCar(scene: Scene, color: string, name: string,kind:CarKind='sport'): CarVisual {
  const shape=carShapes[kind],stretch=shape.length/4.34,sport=kind==='sport';
  const root=MeshBuilder.CreateBox(name,{width:1.84,height:sport?.55:shape.roof+.33,depth:shape.length},scene);
  if(!sport)root.bakeTransformIntoVertices(Matrix.Translation(0,(shape.roof-.33)/2,0));
  root.isVisible=false;root.isPickable=false;root.metadata={carKind:kind};
  const paint=new PBRMaterial(name+'-paint',scene);paint.albedoColor=Color3.FromHexString(color);paint.metallic=.72;paint.roughness=.24;paint.clearCoat.isEnabled=true;paint.clearCoat.intensity=1;paint.clearCoat.roughness=.12;
  const glass=new PBRMaterial(name+'-glass',scene);glass.albedoColor=new Color3(.035,.065,.085);glass.metallic=.35;glass.roughness=.13;glass.backFaceCulling=false;glass.twoSidedLighting=true;
  const dark=material(scene,name+'-rubber','#101419'),alloy=material(scene,name+'-alloy','#b9c6cd'),rear=material(scene,name+'-rear','#b81728',true),front=material(scene,name+'-front','#d3edff',true),brake=material(scene,name+'-brake','#ff3048',true),amber=material(scene,name+'-indicator','#ffb22d',true);
  const materials:Material[]=[paint,glass,dark,alloy,rear,front,brake,amber];
  for(const mat of [paint,glass,dark,alloy,rear,front,brake,amber]){mat.transparencyMode=Material.MATERIAL_OPAQUE;mat.alpha=1;mat.disableDepthWrite=false;mat.maxSimultaneousLights=8;}
  const makeBox=(id:string,x:number,y:number,z:number,w:number,h:number,d:number,mat:Material)=>{
    const mesh=MeshBuilder.CreateBox(name+'-'+id,{width:w,height:h,depth:d*stretch},scene);mesh.parent=root;mesh.position.set(x,y,z*stretch);mesh.material=mat;mesh.isPickable=false;return mesh;
  };
  function surface(id:string,points:number[],indices:number[],mat:Material) {
    // Babylon использует обход лицевой стороны по часовой стрелке: наружу,
    // иначе видна внутренняя стенка и кузов выглядит прозрачным.
    indices=indices.flatMap((_,i)=>i%3===0?[indices[i],indices[i+2],indices[i+1]]:[]);
    const mesh=new Mesh(name+'-'+id,scene),data=new VertexData(),normals:number[]=[];const scaled=points.map((v,i)=>i%3===2?v*stretch:v);data.positions=scaled;data.indices=indices;VertexData.ComputeNormals(scaled,indices,normals);data.normals=normals;data.uvs=Array.from({length:points.length/3*2},()=>0);data.applyToMesh(mesh);mesh.parent=root;mesh.material=mat;mesh.isPickable=false;return mesh;
  }
  // Симметричные сечения: фаски на плечах кузова, низкий нос и широкие задние крылья.
  const sections=[[-2.18,.8,-.29,.12],[-1.83,.96,-.32,.28],[-1.25,.97,-.33,.3],[-.55,.9,-.33,.24],[.72,.9,-.33,.2],[1.38,.97,-.3,.17],[1.9,.89,-.25,.07],[2.17,.79,-.19,-.01]].map(([z,w,b,t])=>[z,w,b,sport?t:t+shape.belt-.17]);
  const positions:number[]=[],indices:number[]=[];
  for(const [z,w,b,t] of sections)positions.push(-w*.86,b,z,w*.86,b,z,w,b+.1,z,w,t-.1,z,w*.86,t,z,-w*.86,t,z,-w,t-.1,z,-w,b+.1,z);
  for(let i=0;i<sections.length-1;i++)for(let s=0;s<8;s++){const a=i*8+s,b=i*8+(s+1)%8;indices.push(a,b,b+8,a,b+8,a+8);}
  for(let i=1;i<7;i++){indices.push(0,i+1,i);const end=(sections.length-1)*8;indices.push(end,end+i,end+i+1);}
  surface('body',positions,indices,paint);
  // Стёкла состоят из четырёх плоскостей, а крыша повторяет сужение стоек.
  const lb=[-.81,shape.belt,shape.rear],rb=[.81,shape.belt,shape.rear],lf=[-.81,shape.belt,shape.front],rf=[.81,shape.belt,shape.front],tlb=[-.68,shape.roof,shape.roofRear],trb=[.68,shape.roof,shape.roofRear],tlf=[-.68,shape.roof-.02,shape.roofFront],trf=[.68,shape.roof-.02,shape.roofFront];
  const face=(id:string,a:number[],b:number[],c:number[],d:number[],mat:Material)=>surface(id,[...a,...b,...c,...d],[0,1,2,0,2,3],mat);
  face('windscreen',lf,rf,trf,tlf,glass);face('rear-window',rb,lb,tlb,trb,kind==='van'?paint:glass);
  face('left-window',lb,lf,tlf,tlb,kind==='van'?paint:glass);face('right-window',rf,rb,trb,trf,kind==='van'?paint:glass);face('roof',tlb,tlf,trf,trb,paint);
  for(const side of [-1,1]){
    makeBox('b-pillar',side*.74,(shape.belt+shape.roof)/2,-.2,.07,shape.roof-shape.belt,.1,paint);
    makeBox('door-handle',side*.915,shape.belt-.025,-.15,.035,.035,.2,alloy);
    if(kind==='van')face('cab-window',[side*.809,shape.belt+.08,.34],[side*.809,shape.belt+.08,shape.front-.07],[side*.689,shape.roof-.1,shape.roofFront-.02],[side*.689,shape.roof-.1,.34],glass);
    if(kind==='suv')makeBox('roof-rail',side*.56,shape.roof+.06,-.55,.06,.07,1.5,dark);
  }
  for(const x of [-.91,.91]){makeBox('skirt',x,-.26,0,.12,.16,2.4,dark);makeBox('mirror',x*1.06,shape.belt+.15,.5,.18,.105,.27,paint);}
  makeBox('splitter',0,-.24,2.07,1.76,.075,.26,dark);makeBox('grille',0,-.04,2.16,1.05,.13,.03,dark);
  makeBox('diffuser',0,-.21,-2.17,1.62,.14,.14,dark);
  if(sport){
    makeBox('rear-wing',0,.54,-1.87,1.87,.065,.32,dark);
    for(const x of [-.6,.6])makeBox('wing-support',x,.37,-1.85,.055,.3,.12,alloy);
    for(const x of [-.24,.24]){
      face('hood-stripe',[x-.065,.215,.76],[x+.065,.215,.76],[x+.065,.082,1.88],[x-.065,.082,1.88],alloy);
      makeBox('roof-stripe',x,shape.roof+.005,-.24,.13,.014,.76,alloy);
    }
  }
  if(kind==='van')for(const x of [-.74,.74])makeBox('rear-hinge',x,.94,-2.05,.06,.9,.07,dark);
  const lamps:AbstractMesh[]=[],brakeLights:AbstractMesh[]=[],indicators:[AbstractMesh[],AbstractMesh[]]=[[],[]];
  for(const x of [-.57,.57]){
    lamps.push(makeBox('headlight',x,.045+(sport?0:shape.belt-.17),2.185,.45,.065,.05,front),makeBox('taillight',x,.095+(sport?0:shape.belt-.17),-2.19,.49,.055,.045,rear));
    brakeLights.push(makeBox('brake-light',x,.095+(sport?0:shape.belt-.17),-2.216,.49,.065,.014,brake));
    for(const z of [-2.2,2.185])indicators[x<0?0:1].push(makeBox('turn-light',Math.sign(x)*.73,.095+(sport?0:shape.belt-.17),z,.11,.075,.065,amber));
    if(sport||x<0)makeBox('exhaust',x,-.23,-2.22,.16,.105,.1,alloy);
  }
  brakeLights.push(makeBox('third-brake',0,shape.belt+.12,shape.rear-.04,.43,.025,.025,brake));
  const wheels:TransformNode[]=[];
  for(const z of [1.35,-1.4])for(const x of [-.89,.89]){
    const pivot=new TransformNode(name+'-wheel-pivot',scene);pivot.parent=root;pivot.position.set(x,-.42,z*stretch);
    const tyre=MeshBuilder.CreateCylinder(name+'-tyre',{diameter:.74,height:.25,tessellation:24},scene);tyre.rotation.z=Math.PI/2;tyre.parent=pivot;tyre.material=dark;
    const rim=MeshBuilder.CreateCylinder(name+'-rim',{diameter:.55,height:.258,tessellation:24},scene);rim.rotation.z=Math.PI/2;rim.parent=pivot;rim.material=alloy;
    const inset=MeshBuilder.CreateCylinder(name+'-rim-inset',{diameter:.45,height:.263,tessellation:16},scene);inset.rotation.z=Math.PI/2;inset.parent=pivot;inset.material=dark;
    for(let i=0;i<5;i++){const spoke=MeshBuilder.CreateBox(name+'-spoke',{width:.27,height:.045,depth:.46},scene);spoke.parent=pivot;spoke.rotation.x=i*Math.PI/5;spoke.material=alloy;}
    const rimParts=pivot.getChildMeshes().filter(m=>m.material===alloy) as Mesh[];
    const mergedRim=Mesh.MergeMeshes(rimParts,true,true);if(mergedRim){mergedRim.bakeTransformIntoVertices(Matrix.Translation(-pivot.position.x,-pivot.position.y,-pivot.position.z));mergedRim.parent=pivot;mergedRim.name=name+'-wheel-alloy';mergedRim.isPickable=false;}
    wheels.push(pivot);
  }
  const lightSet=new Set([...lamps,...brakeLights,...indicators.flat()]);
  for(const mat of [paint,glass,dark,alloy]){const parts=root.getChildMeshes().filter(m=>m.parent===root&&m.material===mat&&!lightSet.has(m)) as Mesh[];if(parts.length>1){const merged=Mesh.MergeMeshes(parts,true,true);if(merged){merged.parent=root;merged.name=name+'-trim-'+mat.name;merged.isPickable=false;}}}
  root.getChildMeshes().forEach(m=>{m.isPickable=false;m.receiveShadows=true;m.metadata={...m.metadata,vehicle:true};});
  const car={root,wheels,lamps,brakeLights,indicators,materials,dispose:()=>{root.dispose();materials.forEach(m=>m.dispose());}};
  setCarLights(car,false,0,0);return car;
}
const trafficModels=new WeakMap<Scene,Map<string,CarVisual>>();
export function createTrafficCar(scene:Scene,color:string,name:string,kind:CarKind='sedan'):CarVisual{
  let palette=trafficModels.get(scene);if(!palette){palette=new Map();trafficModels.set(scene,palette);}
  const key=kind+color;
  let source=palette.get(key);
  if(!source){source=createCar(scene,color,'shared-'+key,kind);source.root.getChildMeshes().forEach(m=>m.isVisible=false);palette.set(key,source);}
  const root=source.root.clone(name,null,true)!;root.isVisible=false;root.isPickable=false;
  const wheels:TransformNode[]=[],lamps:AbstractMesh[]=[],brakeLights:AbstractMesh[]=[],indicators:[AbstractMesh[],AbstractMesh[]]=[[],[]];
  function copy(parent:TransformNode,target:TransformNode){
    for(const child of parent.getChildren()){
      if(!(child instanceof TransformNode))continue;
      const instance=child instanceof Mesh?child.createInstance(name+'-'+child.name):new TransformNode(name+'-'+child.name,scene);
      instance.parent=target;instance.position.copyFrom(child.position);instance.rotation.copyFrom(child.rotation);instance.scaling.copyFrom(child.scaling);instance.rotationQuaternion=child.rotationQuaternion?.clone()||null;
      if(child instanceof Mesh){const m=instance as AbstractMesh;m.isVisible=true;m.isPickable=false;m.receiveShadows=true;m.metadata={vehicle:true};if(source!.lamps.includes(child))lamps.push(m);if(source!.brakeLights.includes(child))brakeLights.push(m);for(let i=0;i<2;i++)if(source!.indicators[i].includes(child))indicators[i].push(m);}
      if(source!.wheels.includes(child))wheels.push(instance);copy(child,instance);
    }
  }
  copy(source.root,root);
  const car={root,wheels,lamps,brakeLights,indicators,materials:[],dispose:()=>root.dispose()};setCarLights(car,false,0,0);return car;
}
