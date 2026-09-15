import { IsIn, IsInt, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

import {
  MAX_DASHBOARD_YEAR,
  MIN_DASHBOARD_YEAR,
  MONTH_KEYS,
} from 'src/common/dashboard-time';

export class MonthYearQueryDto {
  @Transform(({ value }) =>
    String(value ?? '')
      .trim()
      .toLowerCase(),
  )
  @IsIn(MONTH_KEYS, {
    message: `month must be one of: ${MONTH_KEYS.join(', ')} (case-insensitive)`,
  })
  month: string;

  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  @Min(MIN_DASHBOARD_YEAR, {
    message: `year must be ${MIN_DASHBOARD_YEAR} or later`,
  })
  @Max(MAX_DASHBOARD_YEAR, {
    message: `year must be ${MAX_DASHBOARD_YEAR} or earlier`,
  })
  year: number;
}
