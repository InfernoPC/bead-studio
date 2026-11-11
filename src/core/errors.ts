export type Pt = [number, number];

export class OpError extends Error {
  constructor(
    public code: string,
    message: string,
    public opIndex?: number,
    public cells: Pt[] = [],
  ) {
    super(message);
    this.name = 'OpError';
  }
}
