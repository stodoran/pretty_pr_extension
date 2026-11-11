// Toy matrix helpers (demo fixture). The PR only reformats this file.
export type Matrix = number[][];

export function identity(n: number): Matrix {
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
}

export function transpose(m: Matrix): Matrix {
  return m[0].map((_, j) => m.map((row) => row[j]));
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  if (a[0].length !== b.length)
    throw new Error(
      "inner dimensions must match: " + a[0].length + " vs " + b.length,
    );
  const bt = transpose(b);
  return a.map((row) =>
    bt.map((col) => row.reduce((sum, x, k) => sum + x * col[k], 0)),
  );
}

export function describeMatrix(m: Matrix) {
  return {
    rows: m.length,
    cols: m[0]?.length ?? 0,
    square: m.length === (m[0]?.length ?? 0),
  };
}
