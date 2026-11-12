// Sorting helpers (demo fixture).
export function insertionSort(items: number[]): number[] {
  const out = [...items];
  for (let i = 1; i < out.length; i++) {
    const key = out[i];
    let j = i - 1;
    while (j >= 0 && out[j] > key) {
      out[j + 1] = out[j];
      j--;
    }
    out[j + 1] = key;
  }
  return out;
}

export function sortReport(algorithm: (xs: number[]) => number[], data: number[]): string {
  const [stats, name] = computeStats(
    algorithm(data),
    data,
    algorithm.name,
  );
  return name + ': ' + stats;
}

function computeStats(data: number[], name: string, sorted: number[]): [string, string] {
  return [`${data.length} items, sorted=${sorted.join(',')}`, name];
}

export function sortBubble(items: number[]): number[] {
  const out = [...items];
  for (let i = 0; i < out.length; i++) {
    for (let j = 0; j < out.length - i - 1; j++) {
      if (out[j] > out[j + 1]) {
        [out[j], out[j + 1]] = [out[j + 1], out[j]];
      }
    }
  }
  return out;
}
