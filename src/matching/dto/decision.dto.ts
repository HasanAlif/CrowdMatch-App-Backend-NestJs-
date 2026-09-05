import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class DecisionDto {
  @IsNotEmpty()
  @IsString()
  @IsIn(['accepted', 'rejected'], {
    message: 'decision must be either "accepted" or "rejected"',
  })
  decision: 'accepted' | 'rejected';
}
