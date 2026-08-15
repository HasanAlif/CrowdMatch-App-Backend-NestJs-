import {
  IsNotEmpty,
  IsString,
  MinLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class InitialCompleteProfileDto {
  @IsNotEmpty({ message: 'fullName is required' })
  @IsString()
  @MinLength(1, { message: 'fullName must not be blank' })
  fullName: string;

  @Type(() => Number)
  @IsInt({ message: 'age must be a whole number' })
  @Min(12, { message: 'age must be at least 12' })
  @Max(120, { message: 'age must not exceed 120' })
  age: number;
}
