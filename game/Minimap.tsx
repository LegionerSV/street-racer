'use client';
import { useEffect, useRef } from 'react';
import type { Center, HUD, World } from './types';
import {minimapOpponent,raceMarkerPosition} from './race-map-markers';
import {coverageBounds} from './stream-coverage';
export function minimapWorldBounds(loadedTiles:string[]|undefined,center:Center){
  const cells=coverageBounds(loadedTiles,center);
  if(!cells?.length)return{minX:-2500,maxX:2500,minZ:-2500,maxZ:2500};
  return{minX:Math.min(...cells.map(cell=>cell.minX)),maxX:Math.max(...cells.map(cell=>cell.maxX)),minZ:Math.min(...cells.map(cell=>cell.minZ)),maxZ:Math.max(...cells.map(cell=>cell.maxZ))};
}
export function Minimap({ world, hud, mobile=false }: { world: World; hud: HUD; mobile?:boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const base = useRef<{ world: World; canvas: HTMLCanvasElement; size:number } | null>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return;
    const {minX,maxX,minZ,maxZ}=minimapWorldBounds(world.loadedTiles,world.center);
    const originX=(minX+maxX)/2,originZ=(minZ+maxZ)/2;
    const width = 300, height = 240, scale = .23,size=mobile?1024:2000,mapScale=size/Math.max(maxX-minX,maxZ-minZ);
    ctx.clearRect(0, 0, width, height); ctx.fillStyle = '#101b20ed'; ctx.fillRect(0, 0, width, height);
    const transform = (x: number, z: number) => [width / 2 + (x - hud.position.x) * scale, height / 2 - (z - hud.position.z) * scale];
    if (base.current?.world !== world||base.current.size!==size) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
      const map = canvas.getContext('2d')!; map.fillStyle='#101b20';map.fillRect(0,0,size,size);
      const xy=(x:number,z:number)=>[size/2+(x-originX)*mapScale,size/2-(z-originZ)*mapScale];
      for(const area of world.areas)if(area.kind==='water'){
        map.beginPath();for(const ring of [area.points,...(area.holes||[])]){ring.forEach((p,i)=>{const [x,y]=xy(p.x,p.z);if(i)map.lineTo(x,y);else map.moveTo(x,y);});map.closePath();}map.fillStyle='#24596b';map.fill('evenodd');
      }
      map.fillStyle='#28383d';for(const b of world.buildings){map.beginPath();b.footprint.forEach((p,i)=>{const [x,y]=xy(p.x,p.z);if(i)map.lineTo(x,y);else map.moveTo(x,y);});map.closePath();map.fill();}
      map.lineCap='round';map.strokeStyle='#526e78';const seen=new Set<string>();
      for(const e of world.edges){const key=e.way+'/'+Math.min(e.from,e.to)+'/'+Math.max(e.from,e.to);if(e.blocked||seen.has(key))continue;seen.add(key);map.lineWidth=Math.max(1,e.width*mapScale);map.beginPath();e.points.forEach((p,i)=>{const [x,y]=xy(p.x,p.z);if(i)map.lineTo(x,y);else map.moveTo(x,y);});map.stroke();}
      base.current={world,canvas,size};
    }
    const sourceWidth=width/scale*mapScale, sourceHeight=height/scale*mapScale;
    ctx.drawImage(base.current.canvas,size/2+(hud.position.x-originX)*mapScale-sourceWidth/2,size/2-(hud.position.z-originZ)*mapScale-sourceHeight/2,sourceWidth,sourceHeight,0,0,width,height);
    /* Слой дорог и зданий кэшируется один раз; кадр мини-карты только вырезает нужную область. */
    if (hud.race) {
      ctx.strokeStyle = '#d8ff3e'; ctx.lineWidth = 3.5; ctx.beginPath();
      hud.race.route.points.forEach((p, i) => { const [x, y] = transform(p.x, p.z); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); ctx.stroke();
      const point = hud.race.route.points[Math.min(hud.race.checkpoint, hud.race.route.points.length - 1)];
      const [x, y] = transform(point.x, point.z); ctx.fillStyle = '#d8ff3e'; ctx.fillRect(x - 4, y - 4, 8, 8);
    } else if (world.routes.length) {
      for(const route of world.routes){const p=raceMarkerPosition(world,route),[x,y]=transform(p.x,p.z);
        ctx.fillStyle=route.kind==='circuit'?'#d8ff3e':'#65d9ff';ctx.strokeStyle='#101b20';ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y,5,0,2*Math.PI);ctx.fill();ctx.stroke();
      }
    }
    if(hud.race)for(const opponent of hud.opponents||[]){
      const marker=minimapOpponent(opponent,hud.position);
      ctx.save();ctx.translate(marker.x,marker.y);ctx.rotate(marker.heading);ctx.fillStyle=opponent.colour;ctx.strokeStyle='#101b20';ctx.lineWidth=2;ctx.globalAlpha=opponent.finished?.6:1;
      ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,5);ctx.lineTo(0,2);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    }
    ctx.save(); ctx.translate(width / 2, height / 2); ctx.rotate(hud.heading); ctx.fillStyle = '#f4f8e9'; ctx.shadowColor = '#d8ff3e'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 4); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.restore();
    ctx.font = '11px Arial'; ctx.fillStyle = '#a9bec1'; ctx.fillText('С', width - 21, 20); ctx.fillText('200 м', 14, height - 20); ctx.strokeStyle = '#b9d1d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(14, height - 13); ctx.lineTo(14 + 200 * scale, height - 13); ctx.stroke();
    ctx.strokeStyle = '#ffffff30'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, width - 1, height - 1);
  }, [world, hud, mobile]);
  return <canvas className="minimap" ref={ref} width={300} height={240} aria-label="Мини-карта района, старты гонок, маршрут и соперники" />;
}
