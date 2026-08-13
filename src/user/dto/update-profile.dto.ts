import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'fullName must not be blank' })
  fullName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'phoneNumber must not be blank' })
  phoneNumber?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'address must not be blank' })
  address?: string;
}
