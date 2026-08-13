import { IsEmail, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

export class ResendOtpDto {
  @ValidateIf((o) => !o.phone || o.email !== undefined)
  @IsNotEmpty()
  @IsEmail()
  email?: string;

  @ValidateIf((o) => !o.email || o.phone !== undefined)
  @IsNotEmpty()
  @IsString()
  phone?: string;
}
