// Usage and persisted metrics may arrive from external JSON. JavaScript's
// Number coercion treats blanks, booleans, and arrays as numbers, which turns
// unknown data into a measurement. Accept only actual finite numbers and
// non-blank numeric strings. Every current caller measures a quantity (tokens,
// cost, time, or bytes), so negative values are invalid observations too.
export function measuredNumber(value) {
  // `-0 >= 0` holds, so -0 and "-0" would pass through with the sign bit
  // intact. A measurement of nothing is 0, never -0.
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 ? value + 0 : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed + 0 : null;
}

export function isMeasuredNumber(value) {
  return measuredNumber(value) !== null;
}
