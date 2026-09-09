import {expect,it,vi} from 'vitest';
import {desiredChunks,ChunkBudget} from './chunks';
import {trafficBudget} from './traffic';
import {readSettings} from './storage';
it('мобильный профиль хранит меньше кварталов, но заранее готовит полотно перед машиной',()=>{
  // Arrange / Act
  const position={x:240,y:0,z:240},desktop=desiredChunks(position,.7,'high'),mobile=desiredChunks(position,.7,'mobile');
  // Assert
  expect(mobile.length).toBeLessThan(desktop.length*.5);
  for(const key of ['0,0','1,1'])expect(mobile.find(c=>c.key===key)?.lod).toBe(0);
  expect(mobile.some(c=>c.lod===2)).toBe(true);
});
it('мобильные ограничения уменьшают кэш и плотный поток до 48 машин',()=>{
  // Arrange
  const cache=new ChunkBudget<number>(32);for(let i=0;i<32;i++)cache.touch(String(i),i);
  // Act
  cache.setLimit(8);
  // Assert
  expect(cache.size).toBe(8);expect(cache.has('31')).toBe(true);expect(cache.has('0')).toBe(false);
  expect(trafficBudget(100000,'rush',true)).toBe(48);expect(trafficBudget(100000,'city',true)).toBe(36);
});
it('на телефоне по умолчанию выбирается мобильное качество, явный выбор сохраняется',()=>{
  // Arrange
  vi.stubGlobal('localStorage',{getItem:()=>null});
  // Act / Assert
  expect(readSettings(true).quality).toBe('mobile');expect(readSettings(false).quality).toBe('high');expect(readSettings(false).navigator).toBe(true);
  vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({quality:'medium',touchControls:'on',navigator:false})});
  expect(readSettings(true).quality).toBe('medium');expect(readSettings(true).touchControls).toBe('on');expect(readSettings(true).navigator).toBe(false);
  vi.unstubAllGlobals();
});
