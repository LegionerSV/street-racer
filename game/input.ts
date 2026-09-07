export type DrivingKey='KeyW'|'KeyS'|'KeyA'|'KeyD'|'ArrowUp'|'ArrowDown'|'ArrowLeft'|'ArrowRight'|'Space'|'ShiftLeft'|'ShiftRight';
export const drivingKeys=new Set<string>(['KeyW','KeyS','KeyA','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight']);
export class DrivingInput{
  readonly keys=new Set<string>();
  private sources=new Map<string,DrivingKey>();
  press(source:string,key:DrivingKey){this.release(source);this.sources.set(source,key);this.keys.add(key);}
  release(source:string){const key=this.sources.get(source);this.sources.delete(source);if(key&&![...this.sources.values()].includes(key))this.keys.delete(key);}
  clear(){this.sources.clear();this.keys.clear();}
}
