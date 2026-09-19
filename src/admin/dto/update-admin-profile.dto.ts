import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'fullName must not be blank' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  fullName?: string;

  @IsOptional()
  @IsEmail({}, { message: 'email must be a valid email address' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email?: string;

  // Required only when the email is being changed — it is the login credential.
  @ValidateIf((o: UpdateAdminProfileDto) => o.email !== undefined)
  @IsString()
  @IsNotEmpty({ message: 'currentPassword is required to change the email' })
  currentPassword?: string;
}
