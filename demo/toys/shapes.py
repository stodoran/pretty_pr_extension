"""Toy geometry (demo fixture)."""
import math


class Point:
    def __init__(self, x, y):
        self.x = x
        self.y = y

    def distance_to(self, other):
        return math.hypot(self.x - other.x, self.y - other.y)


class Circle:
    """A circle given by its centre and radius."""

    def __init__(self, centre, radius):
        self.centre = centre
        self.radius = radius

    def area(self):
        return math.pi * self.radius ** 2

    def contains(self, point):
        return self.centre.distance_to(point) <= self.radius


class Rectangle:
    def __init__(self, corner, width, height):
        self.corner = corner
        self.width = width
        self.height = height

    def area(self):
        return self.width * self.height

    def perimeter(self):
        return 2 * (self.width + self.height)


def bounding_box(points):
    xs = [p.x for p in points]
    ys = [p.y for p in points]
    return Rectangle(Point(min(xs), min(ys)), max(xs) - min(xs), max(ys) - min(ys))


def largest(shapes, key_function=None, default_value=None, include_zero_area=False):
    candidates = [s for s in shapes if include_zero_area or s.area() > 0]
    if not candidates:
        return default_value
    return max(candidates, key=key_function or (lambda s: s.area()))


def summary(shape):
    name = type(shape).__name__
    kind = (name,)
    label = "a  " + name.lower()
    return {"kind": kind, "label": label, "area": round(shape.area(), 2)}
