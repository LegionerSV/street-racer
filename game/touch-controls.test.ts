import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {TouchControls} from './TouchControls';
import {resolutionScale} from './quality';

it('сенсорная панель содержит все действия и текущий заряд на русском',()=>{
  // Arrange
  const props={onInput:()=>{},onRecover:()=>{},nitro:.5};
  // Act
  const html=renderToStaticMarkup(createElement(TouchControls,props));
  // Assert
  for(const label of ['Сенсорное управление','Повернуть налево','Повернуть направо','Ручник','Нитро','Тормоз и задний ход','Газ','Вернуться на дорогу']){
    expect(html).toContain(`aria-label="${label}"`);
  }
  expect(html).toContain('НИТРО 50%');
  expect(html).toContain('Удобнее играть, повернув телефон горизонтально');
});
it('мобильный профиль ограничивает число пикселей и в портретной ориентации, и на планшете',()=>{
  // Arrange
  const viewports=[[390,844],[844,390],[1366,1024]];
  // Act / Assert
  for(const [width,height] of viewports){
    const scale=resolutionScale('mobile',width,height);
    expect(width*height/(scale*scale)).toBeLessThanOrEqual(960*540+1);
  }
  expect(resolutionScale('high',1920,1080)).toBe(1);
});
