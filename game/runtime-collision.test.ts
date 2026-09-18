import { expect, it } from 'vitest';
import { isStaticCollisionRole } from './runtime';

it('создаёт Havok-коллайдеры для подробных фасадов зданий', () => {
  // Arrange.
  const roles = ['buildings', 'facade0', 'bareFacade3', 'windows'];

  // Act.
  const collisions = roles.map((role) => isStaticCollisionRole(role, 0));

  // Assert.
  expect(collisions).toEqual([true, true, true, false]);
  expect(isStaticCollisionRole('facade0', 1)).toBe(false);
});
