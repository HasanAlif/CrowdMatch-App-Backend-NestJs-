import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class CastVoteDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['positive', 'negative'], {
    message: 'vote must be either "positive" or "negative"',
  })
  vote: 'positive' | 'negative';
}
