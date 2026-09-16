import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const USER_STATUS_FILTERS = ['all', 'active', 'blocked'] as const;
export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

export class ListUsersQueryDto {
  @Transform(({ value }) =>
    String(value ?? 'all')
      .trim()
      .toLowerCase(),
  )
  @IsIn(USER_STATUS_FILTERS, {
    message: `status must be one of: ${USER_STATUS_FILTERS.join(', ')}`,
  })
  status: UserStatusFilter = 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100, { message: 'limit may not exceed 100' })
  limit: number = 50;
}

export class SearchUsersQueryDto extends ListUsersQueryDto {
  @Transform(({ value }) => String(value ?? '').trim())
  @IsString()
  @MinLength(1, { message: 'searchTerm must not be blank' })
  @MaxLength(100, { message: 'searchTerm may not exceed 100 characters' })
  searchTerm: string;
}
