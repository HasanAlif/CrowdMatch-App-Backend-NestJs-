import { IsMongoId, IsOptional } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class MyMatchesQueryDto extends PaginationDto {
  @IsOptional()
  @IsMongoId({ message: 'matchId must be a valid MongoDB ObjectId' })
  matchId?: string;
}
