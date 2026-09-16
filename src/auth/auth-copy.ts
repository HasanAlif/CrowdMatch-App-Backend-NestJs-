import { AccountStatus } from 'src/user/user.types';

export const BLOCKED_LOGIN_MESSAGE =
  'Your Account has been Blocked by Admin due to Violation of Terms & Conditions. ' +
  'Please contact support to recover your account.';

export const INACTIVE_LOGIN_MESSAGE = 'Account is Inactive';

export function loginDenialMessage(
  accountStatus: AccountStatus | undefined,
  isActive: boolean,
): string | null {
  if (accountStatus === AccountStatus.Blocked) {
    return BLOCKED_LOGIN_MESSAGE;
  }

  if (!isActive) {
    return INACTIVE_LOGIN_MESSAGE;
  }

  return null;
}
