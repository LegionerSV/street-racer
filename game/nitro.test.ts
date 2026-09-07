import {expect,it} from 'vitest';
import {NitroCharge} from './nitro';
it('полного баллона хватает на 4,5 секунды, он восстанавливается за 18 секунд',()=>{
  // Arrange
  const nitro=new NitroCharge();
  // Act / Assert
  for(let i=0;i<270;i++)nitro.step(1/60,true,true);
  expect(nitro.charge).toBeCloseTo(0);expect(nitro.step(1/60,true,true)).toBe(0);
  for(let i=0;i<1080;i++)nitro.step(1/60,false,true);
  expect(nitro.charge).toBe(1);
});
it('пустой баллон не даёт дребезжащих микроускорений при удержанной кнопке',()=>{
  // Arrange
  const nitro=new NitroCharge();nitro.charge=.001;
  // Act / Assert
  expect(nitro.step(1/60,true,true)).toBeGreaterThan(0);
  for(let i=0;i<300;i++)expect(nitro.step(1/60,true,true)).toBe(0);
  nitro.step(1/60,false,true);expect(nitro.step(1/60,true,true)).toBe(1);
});
it('заряд не расходуется без контакта с дорогой и не меняется в паузе или отсчёте',()=>{
  // Arrange
  const nitro=new NitroCharge();nitro.charge=.5;
  // Act / Assert
  expect(nitro.step(1,true,false)).toBe(0);expect(nitro.charge).toBeGreaterThan(.5);
  const charge=nitro.charge;nitro.step(10,true,true,true);expect(nitro.charge).toBe(charge);expect(nitro.active).toBe(false);
});
it('восстановление на дороге не пополняет заряд',()=>{
  // Arrange
  const nitro=new NitroCharge();nitro.step(1,true,true);const charge=nitro.charge;
  // Act
  nitro.interrupt();
  // Assert
  expect(nitro.charge).toBe(charge);expect(nitro.active).toBe(false);
});

it('после отпускания в паузе нитро снова доступно, а заряд не обнуляется',()=>{
  // Arrange
  const nitro=new NitroCharge();nitro.step(4.5,true,true);nitro.step(9,true,true);const charge=nitro.charge;
  // Act
  nitro.interrupt();
  // Assert
  expect(nitro.charge).toBe(charge);expect(nitro.step(1/60,true,true)).toBe(1);
});
