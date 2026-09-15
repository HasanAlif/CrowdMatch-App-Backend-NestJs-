import { UNKNOWN_PARTNER_NAME } from '../notification/notification-copy';
import { DELETED_USER_PLACEHOLDER_NAME } from '../common/user-constants';

export const APP_DISPLAY_NAME = 'CrowdMatch';

export function abbreviateName(fullName?: string | null): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return UNKNOWN_PARTNER_NAME;
  if (trimmed === DELETED_USER_PLACEHOLDER_NAME) return trimmed;

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0];

  const first = parts[0];
  const lastInitial = parts[parts.length - 1][0];
  return `${first} ${lastInitial.toUpperCase()}.`;
}

export function displayName(fullName?: string | null): string {
  const trimmed = (fullName ?? '').trim();
  return trimmed || UNKNOWN_PARTNER_NAME;
}

export function formatCompactCount(n: number): string {
  const v = Math.trunc(n);
  if (v < 1000) return String(v);

  if (v < 1_000_000) {
    if (v < 10_000) return `${trimDecimal(v / 1000)}K`;
    return `${Math.round(v / 1000)}K`;
  }

  if (v < 10_000_000) return `${trimDecimal(v / 1_000_000)}M`;
  return `${Math.round(v / 1_000_000)}M`;
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function userJoinedMessage(fullName?: string | null): string {
  return `${displayName(fullName)} joined ${APP_DISPLAY_NAME}`;
}

export function bonusMatchMessage(
  nameA?: string | null,
  nameB?: string | null,
): string {
  return `New match: ${abbreviateName(nameA)} & ${abbreviateName(nameB)}`;
}

export function userBlockedMessage(fullName?: string | null): string {
  return `User ${abbreviateName(fullName)} was blocked`;
}

export function broadcastSentMessage(recipients: number): string {
  const noun = recipients === 1 ? 'user' : 'users';
  return `Broadcast sent to ${formatCompactCount(recipients)} ${noun}`;
}

export function boostMilestoneMessage(fullName?: string | null): string {
  return `${displayName(fullName)} boosted their account`;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatRelativeTime(date: Date, now: Date = new Date()): string {
  const elapsed = now.getTime() - date.getTime();
  if (elapsed < MINUTE_MS) return 'just now';

  if (elapsed < HOUR_MS) {
    const mins = Math.floor(elapsed / MINUTE_MS);
    return `${mins} min ago`;
  }

  if (elapsed < DAY_MS) {
    const hrs = Math.floor(elapsed / HOUR_MS);
    return `${hrs} ${hrs === 1 ? 'hr' : 'hrs'} ago`;
  }

  const days = Math.floor(elapsed / DAY_MS);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
