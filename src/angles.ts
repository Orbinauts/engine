export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
export const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/** A longitude brought into [-180, 180]. */
export function wrapLongitude(degrees: number): number {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

/** An azimuth brought into [0, 360). */
export function wrapAzimuth(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}
