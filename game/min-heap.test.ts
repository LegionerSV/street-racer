import { expect, it } from 'vitest';
import { MinHeap } from './min-heap';
it('извлекает минимумы при чередовании вставок и извлечений, включая равные приоритеты', () => {
  // Arrange
  const queue = new MinHeap<number>((a, b) => a - b);
  const source = Array.from({ length: 301 }, (_, i) => (i * 127) % 53);
  for (const value of source) queue.push(value);
  // Act
  const result = Array.from({ length: 100 }, () => queue.pop()!);
  queue.push(99);
  queue.push(100);
  while (queue.size) result.push(queue.pop()!);
  // Assert
  expect(result).toEqual([...source, 99, 100].sort((a, b) => a - b));
  expect(queue.pop()).toBeUndefined();
});
