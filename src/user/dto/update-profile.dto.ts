import {
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
  IsEnum,
  IsDate,
  IsArray,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Gender } from '../user.types';

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

  @IsOptional()
  @IsEnum(Gender, {
    message: 'gender must be one of: male, female, non_binary, other',
  })
  gender?: Gender;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'dateOfBirth must be a valid date' })
  dateOfBirth?: Date;

  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'bio must not exceed 500 characters' })
  bio?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(Gender, {
    each: true,
    message: 'each value in interestedInGenders must be a valid gender',
  })
  interestedInGenders?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'minAgePreference must be a number' })
  @Min(12, { message: 'minAgePreference must be at least 12' })
  @Max(120, { message: 'minAgePreference must not exceed 120' })
  minAgePreference?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxAgePreference must be a number' })
  @Min(12, { message: 'maxAgePreference must be at least 12' })
  @Max(120, { message: 'maxAgePreference must not exceed 120' })
  maxAgePreference?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: 'maxDistanceKm must be a number' })
  @Min(1, { message: 'maxDistanceKm must be at least 1' })
  @Max(20000, { message: 'maxDistanceKm must not exceed 20000' })
  maxDistanceKm?: number;
}
