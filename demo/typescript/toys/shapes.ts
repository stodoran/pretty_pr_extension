// Shape helpers (demo fixture).
export interface Shape {
  name: string;
  area(): number;
}

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
    return 2 * this.width + 2 * this.height;
  }

  isSquare(): boolean {
    return this.width === this.height;
  }
}

/** A circle given by its radius. */
export class Circle implements Shape {
  name = 'circle';

  constructor(private readonly radius: number) {}

  area(): number {
    return Math.PI * this.radius ** 2;
  }
}

export const DEFAULTS = {radius: 1, width: 2, height: 3};

export function largest(shapes: Shape[], includeEmpty = false): Shape | undefined {
  return shapes.filter((s) => includeEmpty || s.area() > 0).sort((a, b) => b.area() - a.area())[0];
}

export function label(shape: Shape): string {
  return 'a ' + shape.name;
}

export function sizeOf(shape: Shape): number {
  return shape.area();
}

export const VALID_NAME = /^[a-z]+ [a-z]+$/;
