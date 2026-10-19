const MEDICARE_NUMBER_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9 -]{1,32}$/;

/** Preserve meaningful letters, leading zeroes, spacing, and hyphens; remove only surrounding whitespace. */
export function normalizeMedicareNumber(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return MEDICARE_NUMBER_PATTERN.test(trimmed) ? trimmed : null;
}

export function maskMedicareNumber(value: string): string {
  const visible = value.replace(/[^A-Za-z0-9]/g, "").slice(-4);
  return visible ? `•••• ${visible}` : "••••";
}
