import { fibIterative, fibMemo } from './fibonacci';

test('small values', () => {
  expect([0, 1, 2, 3, 4, 5].map(fibIterative)).toEqual([0, 1, 1, 2, 3, 5]);
});

test('memo matches iterative', () => {
  for (let n = 0; n < 20; n++) expect(fibMemo(n)).toBe(fibIterative(n));
});
