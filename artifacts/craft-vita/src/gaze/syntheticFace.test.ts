import { describe, expect, it } from "vitest";
import { distance, generateSyntheticFace, measureIrisCenter, syntheticEyeGeometry } from "./syntheticFace";

describe("synthetic face", () => {
  it("renders a valid RGBA frame with the requested dimensions", () => {
    const face = generateSyntheticFace({ width: 640, height: 360, leftOffset: { x: 12, y: 4 } });
    expect(face.frame.width).toBe(640);
    expect(face.frame.height).toBe(360);
    expect(face.frame.data.length).toBe(640 * 360 * 4);
    expect(face.frame.data.some((value) => value !== 0)).toBe(true);
  });

  it("places the iris at the requested offset (measured from pixels)", () => {
    const offset = { x: 12, y: 1 };
    const face = generateSyntheticFace({ width: 640, height: 360, leftOffset: offset });
    const measured = measureIrisCenter(face.frame, face.geometry.left);
    expect(measured).not.toBeNull();
    expect(distance(measured!, { x: face.geometry.left.center.x + offset.x, y: face.geometry.left.center.y + offset.y })).toBeLessThan(1.2);
  });

  it("is byte-identical for the same seed and options", () => {
    const a = generateSyntheticFace({ width: 160, height: 90, leftOffset: { x: 6, y: 2 }, seed: 5 });
    const b = generateSyntheticFace({ width: 160, height: 90, leftOffset: { x: 6, y: 2 }, seed: 5 });
    expect(Buffer.from(a.frame.data).equals(Buffer.from(b.frame.data))).toBe(true);
    const c = generateSyntheticFace({ width: 160, height: 90, leftOffset: { x: 6, y: 2 }, seed: 6 });
    expect(Buffer.from(a.frame.data).equals(Buffer.from(c.frame.data))).toBe(false);
  });

  it("clamps extreme offsets inside the sclera", () => {
    const face = generateSyntheticFace({ width: 320, height: 180, leftOffset: { x: 500, y: 500 } });
    const measured = measureIrisCenter(face.frame, face.geometry.left);
    expect(measured).not.toBeNull();
    expect(Math.abs(measured!.x - face.geometry.left.center.x)).toBeLessThan(face.geometry.left.width / 2);
    expect(Math.abs(measured!.y - face.geometry.left.center.y)).toBeLessThan(face.geometry.left.height / 2);
  });

  it("uses a consistent eye geometry helper", () => {
    const geometry = syntheticEyeGeometry(1280, 720);
    expect(geometry.left.center.x).toBeCloseTo(1280 * 0.36, 5);
    expect(geometry.right.center.x).toBeCloseTo(1280 * 0.64, 5);
    expect(geometry.left.width).toBeGreaterThan(0);
  });

  it("rejects invalid dimensions", () => {
    expect(() => generateSyntheticFace({ width: 0, height: 10, leftOffset: { x: 0, y: 0 } })).toThrow();
    expect(() => generateSyntheticFace({ width: 10.5, height: 10, leftOffset: { x: 0, y: 0 } })).toThrow();
  });
});
