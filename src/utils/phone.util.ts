import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

export const DEFAULT_PHONE_COUNTRY = 'BD';

export function normalizeToE164(
  raw: string,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(
      raw.trim(),
      defaultCountry as CountryCode,
    );
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

export function detectCountry(
  raw: string,
  defaultCountry: string = DEFAULT_PHONE_COUNTRY,
): string | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return null;
  }

  try {
    const parsed = parsePhoneNumberFromString(
      raw.trim(),
      defaultCountry as CountryCode,
    );
    return parsed?.country ?? null;
  } catch {
    return null;
  }
}

export function maskPhone(raw: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return '<empty>';
  }

  const trimmed = raw.trim();
  const visible = trimmed.slice(-3);
  const hiddenCount = Math.max(trimmed.length - 3, 0);

  return `${'*'.repeat(hiddenCount)}${visible}`;
}
