export function nowIso() {
  return new Date().toISOString();
}

export function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

export function parseEuroToCents(rawValue: string) {
  const normalized = rawValue.trim().replace(",", ".");

  if (!normalized) {
    throw new Error("Bitte einen Betrag eingeben.");
  }

  const value = Number(normalized);

  if (Number.isNaN(value) || value < 0) {
    throw new Error("Bitte einen gültigen positiven Betrag eingeben.");
  }

  return Math.round(value * 100);
}

export function parseSignedEuroToCents(rawValue: string) {
  const normalized = rawValue.trim().replace(",", ".");

  if (!normalized) {
    throw new Error("Bitte einen Betrag eingeben.");
  }

  const value = Number(normalized);

  if (Number.isNaN(value)) {
    throw new Error("Bitte einen gültigen Betrag eingeben.");
  }

  return Math.round(value * 100);
}

export function cleanOptionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

export function assertNonEmpty(value: string | null | undefined, message: string) {
  const normalized = value?.trim() ?? "";

  if (!normalized) {
    throw new Error(message);
  }

  return normalized;
}
