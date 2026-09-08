import { expect, it } from 'vitest';
import { FrameTimings } from './performance';
it('считает p95 по времени кадра, включая подгрузку, с ограниченной памятью', () => {
  // Arrange
  const frames = new FrameTimings(100);
  // Act
  for (let i = 0; i < 200; i++) frames.add(10);
  for (let i = 0; i < 6; i++) frames.add(50, true);
  frames.add(NaN);
  // Assert
  expect(frames.summary()).toEqual({
    samples: 100,
    p95FrameMs: 50,
    meanFrameMs: 12.4,
    overBudgetPercent: 6,
    streamingFrames: 6,
  });
  frames.reset();
  expect(frames.summary()).toEqual({
    samples: 0,
    p95FrameMs: null,
    meanFrameMs: null,
    overBudgetPercent: null,
    streamingFrames: 0,
  });
});
