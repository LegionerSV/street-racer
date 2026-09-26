import { updateVehicleEnvironment } from './vehicle-environment';
import {
  Scene,
  MeshBuilder,
  ShaderMaterial,
  Effect,
  Vector3,
  Color3,
  Color4,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  LinesMesh,
  ShadowGenerator,
  DefaultRenderingPipeline,
  RawTexture,
  Constants,
  Texture,
  StandardMaterial,
  FresnelParameters,
  type BaseTexture,
} from '@babylonjs/core';
import type { Camera } from '@babylonjs/core';
import { weatherAt, type WeatherOptions } from './weather';
import { makeEnvironment } from './visuals';
import { seeded } from './geo';
import { asphaltSurface } from './surface-textures';
import { isLightQuality } from './quality';
export class Atmosphere {
  private sun: DirectionalLight;
  private ambient: HemisphericLight;
  private sky: Mesh;
  private skyMaterial: ShaderMaterial;
  private rain: LinesMesh;
  private drops: Vector3[][];
  private shadows: ShadowGenerator | null;
  private pipeline: DefaultRenderingPipeline | null;
  private rainClock = 0;
  private shadowClock = 0;
  private quality = '';
  private reliefMaps: [StandardMaterial, BaseTexture | null][] = [];
  state = weatherAt(0);
  constructor(
    private scene: Scene,
    private camera: Camera,
    private materials: Record<string, StandardMaterial>,
    quality: string,
  ) {
    makeEnvironment(scene);
    this.sun = new DirectionalLight('sun', new Vector3(-0.5, -0.8, 0.2), scene);
    this.sun.shadowMinZ = 1;
    this.sun.shadowMaxZ = 400;
    this.sun.shadowFrustumSize = 180;
    this.ambient = new HemisphericLight('sky-fill', Vector3.Up(), scene);
    this.ambient.groundColor = new Color3(0.18, 0.19, 0.22);
    this.shadows = isLightQuality(quality) ? null : this.makeShadows(quality);
    this.scene.shadowsEnabled = true;
    this.quality = quality;
    this.pipeline = this.makePipeline(quality);
    Effect.ShadersStore.streetSkyVertexShader = `precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 direction;void main(){direction=position;gl_Position=worldViewProjection*vec4(position,1.0);}`;
    Effect.ShadersStore.streetSkyFragmentShader = `precision highp float;varying vec3 direction;uniform vec3 sunDirection;uniform float daylight;uniform float cloudCover;uniform float clock;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float n=0.0,a=.5;for(int i=0;i<4;i++){n+=noise(p)*a;p=p*2.03+13.7;a*=.5;}return n;}
    void main(){
      vec3 d=normalize(direction);float horizon=pow(1.0-max(0.0,d.y),3.0);
      vec3 night=mix(vec3(.009,.018,.045),vec3(.065,.09,.16),horizon);
      vec3 day=mix(vec3(.12,.37,.68),vec3(.70,.79,.83),horizon);
      float dusk=exp(-abs(sunDirection.y)*8.0)*daylight;
      day=mix(day,vec3(.95,.48,.25),dusk*horizon*.75);
      vec3 color=mix(night,day,daylight);float sunDot=max(0.0,dot(d,sunDirection));
      color+=vec3(1.0,.78,.48)*pow(sunDot,14.0)*.23*(1.0-cloudCover*.7);
      color+=vec3(5.0,3.6,1.8)*smoothstep(.99935,.99965,sunDot)*(1.0-cloudCover*.92);
      float moon=max(0.0,dot(d,-sunDirection));color+=vec3(.65,.78,1.0)*smoothstep(.9995,.9997,moon)*(1.0-daylight);
      if(d.y>.01){vec2 uv=d.xz/(d.y+.18)*1.8+vec2(clock*.0018,clock*.0006);float n=fbm(uv);
        float cloud=smoothstep(.72-cloudCover*.45,.9-cloudCover*.42,n)*smoothstep(.01,.25,d.y);
        vec3 cloudColor=mix(vec3(.08,.12,.2),mix(vec3(.95,.90,.83),vec3(.35,.42,.48),cloudCover),daylight);
        color=mix(color,cloudColor,cloud*.94);
        float star=step(.9988,hash(floor(d.xz/(d.y+.15)*750.0)));color+=star*(1.0-daylight)*(1.0-cloud)*.6;
      }
      gl_FragColor=vec4(color,1.0);
    }`;
    this.skyMaterial = new ShaderMaterial(
      'atmosphere',
      scene,
      { vertex: 'streetSky', fragment: 'streetSky' },
      {
        attributes: ['position'],
        uniforms: [
          'worldViewProjection',
          'sunDirection',
          'daylight',
          'cloudCover',
          'clock',
        ],
      },
    );
    this.skyMaterial.backFaceCulling = false;
    this.skyMaterial.disableDepthWrite = true;
    this.sky = MeshBuilder.CreateSphere(
      'sky-dome',
      { diameter: 4200, segments: 24 },
      scene,
    );
    this.sky.material = this.skyMaterial;
    this.sky.isPickable = false;
    this.sky.infiniteDistance = true;
    this.sky.applyFog = false;
    this.drops = [];
    this.rain = this.makeRain(quality);
    const size = 128,
      { colour, normal, specular } = asphaltSurface(size);
    const asphalt = new RawTexture(
      colour,
      size,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    const relief = new RawTexture(
      normal,
      size,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    const sheen = new RawTexture(
      specular,
      size,
      size,
      Constants.TEXTUREFORMAT_RGBA,
      scene,
      true,
      false,
      Texture.TRILINEAR_SAMPLINGMODE,
    );
    for (const map of [asphalt, relief, sheen])
      map.wrapU = map.wrapV = Texture.WRAP_ADDRESSMODE;
    relief.level = 0.55;
    relief.gammaSpace = sheen.gammaSpace = false;
    materials.road.diffuseTexture = asphalt;
    materials.road.bumpTexture = relief;
    materials.road.specularTexture = sheen;
    materials.road.reflectionTexture = null;
    materials.road.reflectionFresnelParameters = new FresnelParameters({
      bias: 0.02,
      power: 5,
      leftColor: new Color3(0.22, 0.25, 0.28),
      rightColor: Color3.Black(),
    });
    materials.water.reflectionTexture = scene.environmentTexture;
    materials.water.reflectionFresnelParameters = new FresnelParameters({
      bias: 0.25,
      power: 3,
      leftColor: new Color3(0.35, 0.4, 0.43),
      rightColor: new Color3(0.025, 0.045, 0.055),
    });
    for (const role of ['road', 'facade0', 'facade1', 'facade2'])
      if (materials[role])
        this.reliefMaps.push([materials[role], materials[role].bumpTexture]);
    this.configureRelief(quality);
  }
  private configureRelief(quality: string) {
    for (const [material, map] of this.reliefMaps)
      material.bumpTexture = isLightQuality(quality) ? null : map;
  }
  private makePipeline(quality: string) {
    if (quality === 'mobile') {
      const processing = this.scene.imageProcessingConfiguration;
      processing.toneMappingEnabled = false;
      processing.contrast = 1;
      processing.exposure = 1;
      return null;
    }
    const pipeline = new DefaultRenderingPipeline(
      'cinematic',
      true,
      this.scene,
      [this.camera],
    );
    pipeline.fxaaEnabled = true;
    pipeline.samples = quality === 'high' ? 4 : quality === 'medium' ? 2 : 1;
    pipeline.imageProcessingEnabled = true;
    pipeline.imageProcessing.toneMappingEnabled = true;
    pipeline.imageProcessing.toneMappingType = 1;
    pipeline.imageProcessing.contrast = 1.08;
    pipeline.imageProcessing.exposure = 1.15;
    pipeline.bloomEnabled = !isLightQuality(quality);
    pipeline.bloomThreshold = 1.2;
    pipeline.bloomWeight = 0.12;
    pipeline.bloomKernel = 32;
    return pipeline;
  }
  private makeShadows(quality: string) {
    const shadows = new ShadowGenerator(
      quality === 'high' ? 2048 : 1024,
      this.sun,
    );
    shadows.useBlurExponentialShadowMap = true;
    shadows.blurKernel = 12;
    shadows.darkness = 0.3;
    shadows.bias = 0.0005;
    return shadows;
  }
  private makeRain(quality: string) {
    this.drops = Array.from(
      { length: quality === 'mobile' ? 96 : quality === 'low' ? 160 : 420 },
      (_, i) => {
        const x = (seeded(i * 71) - 0.5) * 45,
          z = (seeded(i * 113) - 0.5) * 45,
          y = seeded(i * 97) * 22;
        return [new Vector3(x, y, z), new Vector3(x - 0.15, y - 1.1, z)];
      },
    );
    const rain = MeshBuilder.CreateLineSystem(
      'rain',
      { lines: this.drops, updatable: true },
      this.scene,
    );
    rain.color = new Color3(0.68, 0.81, 0.9);
    rain.alpha = 0.42;
    rain.isPickable = false;
    rain.setEnabled(false);
    return rain;
  }
  update(
    seconds: number,
    dt: number,
    position: Vector3,
    options: WeatherOptions,
    quality: string,
  ) {
    if (this.quality !== quality) {
      this.quality = quality;
      this.pipeline?.dispose();
      this.pipeline = this.makePipeline(quality);
      this.configureRelief(quality);
      if (isLightQuality(quality)) {
        this.shadows?.dispose();
        this.shadows = null;
      } else {
        this.shadows ??= this.makeShadows(quality);
        this.shadows.mapSize = quality === 'high' ? 2048 : 1024;
      }
      this.scene.shadowsEnabled = true;
      if (
        this.drops.length !==
        (quality === 'mobile' ? 96 : quality === 'low' ? 160 : 420)
      ) {
        this.rain.dispose();
        this.rain = this.makeRain(quality);
      }
    }
    const s = (this.state = weatherAt(seconds, options)),
      angle = ((s.hour - 6) / 24) * Math.PI * 2,
      dir = new Vector3(Math.cos(angle), Math.sin(angle), 0.35).normalize();
    this.skyMaterial.setVector3('sunDirection', dir);
    this.skyMaterial.setFloat('daylight', s.daylight);
    this.skyMaterial.setFloat('cloudCover', s.clouds);
    this.skyMaterial.setFloat('clock', seconds);
    const lightDir = s.sunHeight > 0 ? dir : dir.scale(-1);
    this.sun.direction.copyFrom(lightDir.scale(-1));
    this.sun.position.copyFrom(position.add(lightDir.scale(180)));
    this.sun.intensity =
      (s.sunHeight > 0 ? 2.1 * s.daylight : 0.12) * (1 - s.clouds * 0.65);
    this.sun.diffuse = Color3.Lerp(
      new Color3(1, 0.56, 0.3),
      new Color3(1, 0.96, 0.85),
      Math.max(0, s.sunHeight),
    );
    this.ambient.intensity = 0.25 + s.daylight * 0.75;
    this.ambient.diffuse = Color3.Lerp(
      new Color3(0.38, 0.5, 0.85),
      new Color3(0.74, 0.85, 1),
      s.daylight,
    );
    updateVehicleEnvironment(this.scene, s.daylight, s.clouds);
    this.scene.environmentIntensity = 0.35 + s.daylight * 0.45;
    this.scene.fogColor = Color3.Lerp(
      new Color3(0.045, 0.065, 0.11),
      new Color3(0.55, 0.64, 0.7),
      s.daylight,
    );
    this.scene.clearColor = Color4.FromColor3(this.scene.fogColor, 1);
    this.scene.fogDensity =
      (quality === 'mobile' ? 0.0022 : quality === 'high' ? 0.00065 : 0.001) +
      s.rain * 0.0012;
    for (const role of ['facade0', 'facade1', 'facade2'])
      this.materials[role]?.emissiveColor.setAll((1 - s.daylight) * 0.65);
    this.materials.windows.emissiveColor.setAll(0.12 + (1 - s.daylight) * 0.8);
    this.materials.windows.diffuseColor.setAll(0.22 + s.daylight * 0.25);
    const wet = Math.max(0, Math.min(1, (s.wetness - 0.15) / 0.85)),
      gloss = wet * wet * (3 - 2 * wet);
    this.materials.road.specularColor.setAll(0.015 + gloss * 0.8);
    this.materials.road.specularPower = 24 + gloss * 80;
    this.materials.road.reflectionTexture =
      gloss > 0.001 ? this.scene.environmentTexture : null;
    this.materials.road.reflectionFresnelParameters!.leftColor.setAll(
      gloss * 0.16,
    );
    this.materials.road.reflectionFresnelParameters!.rightColor.setAll(
      gloss * 0.67,
    );
    this.materials.water.diffuseColor = Color3.Lerp(
      new Color3(0.035, 0.09, 0.13),
      new Color3(0.08, 0.25, 0.32),
      s.daylight,
    );
    this.rain.setEnabled(s.rain > 0.02);
    this.rain.alpha = 0.38 * s.rain;
    this.rain.position.copyFrom(position);
    this.rainClock += dt;
    if (
      s.rain > 0.02 &&
      dt > 0 &&
      (quality !== 'mobile' || this.rainClock >= 1 / 30)
    ) {
      const rainDt = Math.min(0.1, this.rainClock);
      this.rainClock = 0;
      for (const pair of this.drops) {
        for (const p of pair) {
          p.y -= rainDt * 24;
          p.x -= rainDt * 3;
        }
        if (pair[0].y < -2) {
          pair[0].y += 24;
          pair[1].y += 24;
        }
        if (pair[0].x < -23) {
          pair[0].x += 46;
          pair[1].x += 46;
        }
      }
      MeshBuilder.CreateLineSystem(
        'rain',
        { lines: this.drops, instance: this.rain },
        this.scene,
      );
    }
    this.shadowClock -= dt;
    if (this.shadowClock <= 0) {
      this.shadowClock = 0.5;
      const map = this.shadows?.getShadowMap();
      if (map)
        map.renderList = isLightQuality(quality)
          ? []
          : this.scene.meshes.filter(
              (m) =>
                m.isVisible &&
                m.name !== 'sky-dome' &&
                !m.name.includes('window') &&
                !m.name.includes('light') &&
                ((m.metadata?.vehicle &&
                  m
                    .getBoundingInfo()
                    .boundingBox.centerWorld.subtract(position)
                    .length() < 65) ||
                  ((m.name.endsWith(':buildings') ||
                    /:facade[0-2]$/.test(m.name) ||
                    m.name.endsWith(':structures')) &&
                    m
                      .getBoundingInfo()
                      .boundingBox.centerWorld.subtract(position)
                      .length() < 180)),
            );
    }
  }
  dispose() {
    this.pipeline?.dispose();
    this.shadows?.dispose();
    this.rain.dispose();
    this.sky.dispose();
    this.skyMaterial.dispose();
  }
}
