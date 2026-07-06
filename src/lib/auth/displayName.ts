const FALLBACK_DISPLAY_NAME = 'Manager';
const MAX_DISPLAY_NAME_LENGTH = 32;

// Derives a starter display name from an email's local part (before '@'),
// used to seed a profile row right after a magic-link/OAuth sign-in.
// Never returns an empty string - falls back to a generic label instead.
export function displayNameFromEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex === -1) {
    return FALLBACK_DISPLAY_NAME;
  }

  const localPart = email.slice(0, atIndex).trim();
  if (localPart.length === 0) {
    return FALLBACK_DISPLAY_NAME;
  }

  return localPart.slice(0, MAX_DISPLAY_NAME_LENGTH);
}
