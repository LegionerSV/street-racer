import { expect, it, vi } from 'vitest';
import { renderFirstFrame } from './render-ready';

it('сохраняет экран загрузки до готовности и отрисовки материалов', async () => {
  // Arrange
  let ready!: () => void;
  const materials = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const draw = vi.fn();
  let playing = false;
  // Act
  const start = renderFirstFrame(
    () => materials,
    draw,
    new AbortController().signal,
  ).then(() => {
    playing = true;
  });
  await Promise.resolve();
  // Assert
  expect(draw).toHaveBeenCalledTimes(1);
  expect(playing).toBe(false);
  ready();
  await start;
  expect(draw).toHaveBeenCalledTimes(2);
  expect(playing).toBe(true);
});
it('отмена загрузки не ждёт зависшего материала и не рисует уничтоженную сцену', async () => {
  // Arrange
  const control = new AbortController(),
    draw = vi.fn();
  // Act
  const start = renderFirstFrame(
    () => new Promise(() => {}),
    draw,
    control.signal,
  );
  control.abort(new Error('Загрузка отменена.'));
  // Assert
  await expect(start).rejects.toThrow('Загрузка отменена.');
  expect(draw).toHaveBeenCalledTimes(1);
});
