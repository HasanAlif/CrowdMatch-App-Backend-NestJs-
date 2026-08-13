import {
  IsNotEmpty,
  IsString,
  IsPhoneNumber,
  MinLength,
} from 'class-validator';

// DTO for phone-based registration (POST /auth/register/phone).
export class RegisterWithPhoneDto {
  @IsNotEmpty()
  @IsString()
  fullName: string;

  // Must be in E.164 format (e.g. +8801712345678).
  // @IsPhoneNumber() with no region argument validates E.164 globally.
  @IsNotEmpty()
  @IsPhoneNumber()
  phone: string;

  @IsNotEmpty()
  @MinLength(6)
  password: string;
}
