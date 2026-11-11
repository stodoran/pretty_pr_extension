// Rectangles (demo fixture).
import type { Shape } from './shapes';

export class Rectangle implements Shape {
  name = 'rectangle';

  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  area(): number {
    return this.width * this.height;
  }

  perimeter(): number {
    return 2 * (this.width + this.height);
  }

  isSquare(): boolean {
    return this.width === this.height;
  }
}
