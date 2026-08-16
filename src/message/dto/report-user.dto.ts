import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportReason } from '../schemas/report.schema';

export class ReportUserDto {
  @IsEnum(ReportReason, {
    message: `reason must be one of: ${Object.values(ReportReason).join(', ')}`,
  })
  reason: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: 'details must not exceed 2000 characters' })
  details?: string;
}
