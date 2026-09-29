/**
 * Minimal browser globals for pdfjs-dist under Node.
 *
 * pdfjs evaluates `new DOMMatrix()` at module load and, when `@napi-rs/canvas`
 * is not installed (it is not in the production image — the alpine builder and
 * slim runner would need different native binaries anyway), the import throws
 * "DOMMatrix is not defined". We only use pdfjs for `getTextContent()`, which
 * never renders, so a correct-but-small 2D affine DOMMatrix plus inert Path2D /
 * ImageData stand-ins are enough. Installed once, only when the globals are
 * missing (never in a browser).
 */

type M6 = [number, number, number, number, number, number];

class DOMMatrixPolyfill {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;

  constructor(init?: number[] | DOMMatrixPolyfill | string) {
    if (Array.isArray(init)) {
      if (init.length === 6) [this.a, this.b, this.c, this.d, this.e, this.f] = init as M6;
      else if (init.length === 16) {
        this.a = init[0]; this.b = init[1]; this.c = init[4]; this.d = init[5]; this.e = init[12]; this.f = init[13];
      }
    } else if (init && typeof init === 'object') {
      Object.assign(this, { a: init.a, b: init.b, c: init.c, d: init.d, e: init.e, f: init.f });
    }
  }

  // 4x4 aliases pdfjs may read
  get m11() { return this.a; } get m12() { return this.b; }
  get m21() { return this.c; } get m22() { return this.d; }
  get m41() { return this.e; } get m42() { return this.f; }
  get is2D() { return true; }
  get isIdentity() { return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0; }

  static fromMatrix(m: DOMMatrixPolyfill) { return new DOMMatrixPolyfill(m); }
  static fromFloat64Array(a: Float64Array) { return new DOMMatrixPolyfill(Array.from(a)); }
  static fromFloat32Array(a: Float32Array) { return new DOMMatrixPolyfill(Array.from(a)); }

  private static mul(x: DOMMatrixPolyfill, y: DOMMatrixPolyfill): M6 {
    // result = x · y (apply y first, then x)
    return [
      x.a * y.a + x.c * y.b,
      x.b * y.a + x.d * y.b,
      x.a * y.c + x.c * y.d,
      x.b * y.c + x.d * y.d,
      x.a * y.e + x.c * y.f + x.e,
      x.b * y.e + x.d * y.f + x.f,
    ];
  }
  private set(m: M6) { [this.a, this.b, this.c, this.d, this.e, this.f] = m; return this; }

  multiply(o: DOMMatrixPolyfill) { return new DOMMatrixPolyfill(DOMMatrixPolyfill.mul(this, o)); }
  multiplySelf(o: DOMMatrixPolyfill) { return this.set(DOMMatrixPolyfill.mul(this, o)); }
  preMultiplySelf(o: DOMMatrixPolyfill) { return this.set(DOMMatrixPolyfill.mul(o, this)); }
  translate(tx = 0, ty = 0) { return this.multiply(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])); }
  translateSelf(tx = 0, ty = 0) { return this.multiplySelf(new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty])); }
  scale(sx = 1, sy = sx) { return this.multiply(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0])); }
  scaleSelf(sx = 1, sy = sx) { return this.multiplySelf(new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0])); }
  inverse() { return new DOMMatrixPolyfill(this).invertSelf(); }
  invertSelf() {
    const det = this.a * this.d - this.b * this.c;
    if (!det) { this.a = this.b = this.c = this.d = this.e = this.f = NaN; return this; }
    return this.set([
      this.d / det, -this.b / det, -this.c / det, this.a / det,
      (this.c * this.f - this.d * this.e) / det, (this.b * this.e - this.a * this.f) / det,
    ]);
  }
  transformPoint(p: { x?: number; y?: number } = {}) {
    const x = p.x ?? 0, y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }
  toFloat64Array() {
    return new Float64Array([this.a, this.b, 0, 0, this.c, this.d, 0, 0, 0, 0, 1, 0, this.e, this.f, 0, 1]);
  }
  toFloat32Array() { return new Float32Array(this.toFloat64Array()); }
  toJSON() { return { a: this.a, b: this.b, c: this.c, d: this.d, e: this.e, f: this.f, is2D: true }; }
}

class Path2DPolyfill {
  addPath() {} moveTo() {} lineTo() {} closePath() {} rect() {} arc() {}
  bezierCurveTo() {} quadraticCurveTo() {} ellipse() {}
}

class ImageDataPolyfill {
  data: Uint8ClampedArray; width: number; height: number;
  constructor(a: number | Uint8ClampedArray, b: number, c?: number) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; }
  }
}

let installed = false;

/** Idempotent; safe to call before every pdfjs import. */
export function ensurePdfjsNodeGlobals(): void {
  if (installed || typeof window !== 'undefined') return;
  const g = globalThis as any;
  if (!g.DOMMatrix) g.DOMMatrix = DOMMatrixPolyfill;
  if (!g.Path2D) g.Path2D = Path2DPolyfill;
  if (!g.ImageData) g.ImageData = ImageDataPolyfill;
  installed = true;
}
