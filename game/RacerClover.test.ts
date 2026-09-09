import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RacerClover } from './RacerClover';

it('показывает три заполняемых лепестка с короткими характеристиками', () => {
  // Arrange
  const traits = { accuracy: .78, aggression: .64, reaction: .83 };
  // Act
  const html = renderToStaticMarkup(createElement(RacerClover, { traits }));
  // Assert
  expect(html).toContain('Точность 78%');
  expect(html).toContain('Агрессия 64%');
  expect(html).toContain('Реакция 83%');
  expect((html.match(/clover-petal-fill/g) || [])).toHaveLength(3);
});
