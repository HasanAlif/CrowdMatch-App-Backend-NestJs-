import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAdminProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'fullName must not be blank' })
  fullName?: string;
}
