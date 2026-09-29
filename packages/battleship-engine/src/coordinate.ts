/** A cell of the board. `x` is the column (A–J), `y` the row (1–10), both zero-based. */
export class Coordinate {
  private constructor(
    readonly x: number,
    readonly y: number,
  ) {}

  static of(x: number, y: number): Coordinate {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      throw new RangeError(`Coordinate must be integers, got ${x},${y}`);
    }
    return new Coordinate(x, y);
  }

  /** Parses a human label such as "A1" or "J10". */
  static parse(label: string): Coordinate {
    const match = /^([A-Z])(\d{1,2})$/.exec(label.trim().toUpperCase());
    if (!match) throw new RangeError(`Not a coordinate: ${label}`);
    return new Coordinate(
      (match[1] as string).charCodeAt(0) - 65,
      Number(match[2]) - 1,
    );
  }

  /** Stable identity for maps and sets. */
  get key(): string {
    return `${this.x},${this.y}`;
  }

  get label(): string {
    return `${String.fromCharCode(65 + this.x)}${this.y + 1}`;
  }

  equals(other: Coordinate): boolean {
    return this.x === other.x && this.y === other.y;
  }

  inside(size: number): boolean {
    return this.x >= 0 && this.y >= 0 && this.x < size && this.y < size;
  }

  /** The eight surrounding cells, inside the board or not. */
  around(): Coordinate[] {
    const cells: Coordinate[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx !== 0 || dy !== 0)
          cells.push(new Coordinate(this.x + dx, this.y + dy));
      }
    }
    return cells;
  }

  /** Up, down, left and right neighbours, inside the board or not. */
  orthogonal(): Coordinate[] {
    return [
      new Coordinate(this.x + 1, this.y),
      new Coordinate(this.x - 1, this.y),
      new Coordinate(this.x, this.y + 1),
      new Coordinate(this.x, this.y - 1),
    ];
  }

  toJSON(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
}
