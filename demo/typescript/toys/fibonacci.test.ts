import { fibIterative } from './fibonacci';

test('small values', () => {
  expect([0, 1, 2, 3, 4, 5].map(fibIterative)).toEqual([0, 1, 1, 2, 3, 5]);
});
