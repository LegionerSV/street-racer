import { expect, it } from 'vitest';
import {
  FrameTimings,
  FrameWorkTimings,
  RenderWorkTimings,
} from './performance';

it('различает неизвестные этапы рендера и измеренный ноль в ограниченной истории', () => {
  // Arrange
  const timings = new RenderWorkTimings(2);
  expect(timings.summary()).toBeNull();
  // Act
  timings.add({
    activeMeshesEvaluation: 100,
    renderTargets: 100,
    mainPass: 100,
  });
  timings.add({ activeMeshesEvaluation: 8, renderTargets: 0, mainPass: null });
  timings.add({ activeMeshesEvaluation: 4, renderTargets: NaN, mainPass: -1 });
  // Assert
  expect(timings.summary()).toEqual({
    frames: 2,
    activeMeshesEvaluation: { samples: 2, meanMs: 6, p95Ms: 8 },
    renderTargets: { samples: 1, meanMs: 0, p95Ms: 0 },
    mainPass: null,
  });
  // Act
  timings.reset();
  // Assert
  expect(timings.summary()).toBeNull();
  timings.add({
    activeMeshesEvaluation: null,
    renderTargets: null,
    mainPass: null,
  });
  expect(timings.summary()).toEqual({
    frames: 1,
    activeMeshesEvaluation: null,
    renderTargets: null,
    mainPass: null,
  });
});

it('замеры работы кадра учитывают нулевую нагрузку и ограничивают историю', () => {
  // Arrange
  const timings = new FrameWorkTimings(2);
  expect(timings.summary()).toBeNull();
  // Act
  timings.add({
    physics: 100,
    traffic: 50,
    visuals: 10,
    render: 20,
    install: 30,
  });
  timings.add({ physics: 10, traffic: 4, visuals: 1, render: 3, install: 0 });
  timings.add({ physics: 0, traffic: 0, visuals: 0, render: 1, install: 0 });
  // Assert
  expect(timings.summary()).toEqual({
    samples: 2,
    physics: { meanMs: 5, p95Ms: 10 },
    traffic: { meanMs: 2, p95Ms: 4 },
    visuals: { meanMs: 0.5, p95Ms: 1 },
    render: { meanMs: 2, p95Ms: 3 },
    install: { meanMs: 0, p95Ms: 0 },
  });
  timings.reset();
  expect(timings.summary()).toBeNull();
});
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
