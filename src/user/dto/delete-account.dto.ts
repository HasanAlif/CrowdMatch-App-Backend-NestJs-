import { IsOptional, IsString } from 'class-validator';

export class DeleteAccountDto {
  // Required for local-auth accounts (those that have a password).
  @IsOptional()
  @IsString()
  password?: string;

  // Required for social-auth accounts; must be exactly "DELETE".
  @IsOptional()
  @IsString()
  confirmText?: string;
}

// The exact phrase a social-auth account must send to confirm deletion.
export const DELETE_CONFIRM_TEXT = 'DELETE';
