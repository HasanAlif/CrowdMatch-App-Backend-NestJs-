import { PairOutcome } from '../matching/schemas/matched-pair.schema';

export type ChatDenialReason =
  'blocked' | 'not_matched' | 'unknown_user' | 'account_deleted';

export type ChatPermission =
  { allowed: true } | { allowed: false; reason: ChatDenialReason };

export interface ChatPermissionInputs {
  senderExists: boolean;
  receiverExists: boolean;
  senderBlockedReceiver: boolean;
  receiverBlockedSender: boolean;
  senderDeleted: boolean;
  receiverDeleted: boolean;
  outcome: PairOutcome | null | undefined;
}

export function decideChatPermission(
  input: ChatPermissionInputs,
): ChatPermission {
  if (!input.senderExists || !input.receiverExists) {
    return { allowed: false, reason: 'unknown_user' };
  }

  if (input.senderDeleted || input.receiverDeleted) {
    return { allowed: false, reason: 'account_deleted' };
  }

  if (input.senderBlockedReceiver || input.receiverBlockedSender) {
    return { allowed: false, reason: 'blocked' };
  }

  if (input.outcome !== PairOutcome.Mutual) {
    return { allowed: false, reason: 'not_matched' };
  }

  return { allowed: true };
}

export interface ChatErrorCopy {
  code: string;
  message: string;
}

export const CHAT_DENIAL_COPY: Record<ChatDenialReason, ChatErrorCopy> = {
  blocked: {
    code: 'BLOCKED',
    message: 'You are not permitted to message this user',
  },
  not_matched: {
    code: 'NOT_MATCHED',
    message:
      "You can only message people you've matched with. " +
      'Keep voting to find your match!',
  },
  unknown_user: {
    code: 'USER_NOT_FOUND',
    message: 'You are not permitted to message this user',
  },
  account_deleted: {
    code: 'ACCOUNT_DELETED',
    message: 'This account is no longer available.',
  },
};

export function chatDenialCopy(reason: ChatDenialReason): ChatErrorCopy {
  return CHAT_DENIAL_COPY[reason];
}
