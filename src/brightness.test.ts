import { describe, expect, test } from "vitest";
import { phaseAngle, predictedMagnitude, STANDARD_MAGNITUDE_RANGE_KM } from "./brightness.js";
import { toRadians } from "./angles.js";

const ISS_STANDARD_MAGNITUDE = -1.8;

describe("predictedMagnitude", () => {
  test("returns the Standard magnitude at the reference geometry: 1,000 km away, half lit", () => {
    expect(predictedMagnitude(ISS_STANDARD_MAGNITUDE, STANDARD_MAGNITUDE_RANGE_KM, toRadians(90))).toBeCloseTo(ISS_STANDARD_MAGNITUDE, 10);
  });

  test("a fully lit Satellite at the reference range is 0.75 magnitudes brighter", () => {
    expect(predictedMagnitude(ISS_STANDARD_MAGNITUDE, STANDARD_MAGNITUDE_RANGE_KM, 0)).toBeCloseTo(ISS_STANDARD_MAGNITUDE - 2.5 * Math.log10(2), 10);
  });

  test("twice the range is 1.5 magnitudes fainter", () => {
    expect(predictedMagnitude(ISS_STANDARD_MAGNITUDE, 2 * STANDARD_MAGNITUDE_RANGE_KM, toRadians(90))).toBeCloseTo(
      ISS_STANDARD_MAGNITUDE + 5 * Math.log10(2),
      10,
    );
  });

  test("a quarter lit is 0.75 magnitudes fainter than half lit", () => {
    const quarterLit = predictedMagnitude(ISS_STANDARD_MAGNITUDE, STANDARD_MAGNITUDE_RANGE_KM, toRadians(120));
    expect(quarterLit).toBeCloseTo(ISS_STANDARD_MAGNITUDE + 2.5 * Math.log10(2), 10);
  });

  test("a Satellite lit exactly from behind is very faint rather than infinitely faint", () => {
    const backlit = predictedMagnitude(ISS_STANDARD_MAGNITUDE, STANDARD_MAGNITUDE_RANGE_KM, Math.PI);
    expect(Number.isFinite(backlit)).toBe(true);
    expect(backlit).toBeGreaterThan(10);
  });

  test("brightens as the Satellite comes closer and as more of it is lit", () => {
    const far = predictedMagnitude(ISS_STANDARD_MAGNITUDE, 1500, toRadians(90));
    const near = predictedMagnitude(ISS_STANDARD_MAGNITUDE, 400, toRadians(90));
    const nearAndFullerLit = predictedMagnitude(ISS_STANDARD_MAGNITUDE, 400, toRadians(40));
    expect(near).toBeLessThan(far);
    expect(nearAndFullerLit).toBeLessThan(near);
  });
});

describe("phaseAngle", () => {
  const satellite = { x: 7000, y: 0, z: 0 };

  test("is a right angle when the Sun lights the Satellite from the side", () => {
    const observer = { x: 6378, y: 0, z: 0 };
    const sun = { x: 7000, y: 149_600_000, z: 0 };
    expect(phaseAngle(satellite, observer, sun)).toBeCloseTo(Math.PI / 2, 4);
  });

  test("is zero when the Sun is behind the Observer", () => {
    const observer = { x: 6378, y: 0, z: 0 };
    const sun = { x: -149_600_000, y: 0, z: 0 };
    expect(phaseAngle(satellite, observer, sun)).toBeCloseTo(0, 4);
  });

  test("is a straight angle when the Satellite is between the Sun and the Observer", () => {
    const observer = { x: 6378, y: 0, z: 0 };
    const sun = { x: 149_600_000, y: 0, z: 0 };
    expect(phaseAngle(satellite, observer, sun)).toBeCloseTo(Math.PI, 4);
  });
});
