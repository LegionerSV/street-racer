import { expect, it } from 'vitest';
import { trafficDecisionDue } from './traffic-decisions';

it('считает решения 20 раз за секунду при 60 шагах движения', () => {
  // Arrange
  let last: number | undefined;
  const decisions: number[] = [];
  // Act
  for (let step = 0; step < 60; step++) {
    const time = step / 60;
    if (trafficDecisionDue(time, last, false)) {
      decisions.push(step);
      last = time;
    }
  }
  // Assert
  expect(decisions).toEqual(Array.from({ length: 20 }, (_, i) => i * 3));
});

it.each([undefined, 0, 1])(
  'сразу реагирует на опасность при предыдущем решении %s',
  (last) => {
    // Arrange / Act
    const due = trafficDecisionDue(1, last, true);
    // Assert
    expect(due).toBe(true);
  },
);

it('обрабатывает смену сети, возврат времени и долгий кадр без догоняющих решений', () => {
  // Arrange / Act
  const states = [
    trafficDecisionDue(2, undefined, false),
    trafficDecisionDue(0, 2, false),
    trafficDecisionDue(3, 2, false),
    trafficDecisionDue(2.01, 2, false),
  ];
  // Assert
  expect(states).toEqual([true, true, true, false]);
});
