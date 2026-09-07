import {expect,it} from 'vitest';
import {DrivingInput} from './input';
it('одновременно держит газ, руль и нитро с разных пальцев',()=>{
  // Arrange
  const input=new DrivingInput();
  // Act
  input.press('touch:1','KeyW');input.press('touch:2','KeyD');input.press('touch:3','ShiftLeft');input.release('touch:2');
  // Assert
  expect([...input.keys].sort()).toEqual(['KeyW','ShiftLeft']);
});
it('отпускание пальца не сбрасывает газ, который ещё удерживается клавиатурой или другим пальцем',()=>{
  // Arrange
  const input=new DrivingInput();input.press('key:KeyW','KeyW');input.press('touch:1','KeyW');input.press('touch:2','KeyW');
  // Act / Assert
  input.release('touch:1');expect(input.keys.has('KeyW')).toBe(true);
  input.release('key:KeyW');expect(input.keys.has('KeyW')).toBe(true);
  input.release('touch:2');expect(input.keys.size).toBe(0);
});
it('пауза и отмена жеста убирают удержанные кнопки, запоздалое отпускание безопасно',()=>{
  // Arrange
  const input=new DrivingInput();input.press('touch:1','KeyW');input.press('touch:2','Space');
  // Act
  input.clear();input.release('touch:1');input.press('touch:3','KeyA');
  // Assert
  expect([...input.keys]).toEqual(['KeyA']);
});
