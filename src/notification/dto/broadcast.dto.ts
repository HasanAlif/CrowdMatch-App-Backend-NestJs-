import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// POST /admin/notifications/broadcast
export class BroadcastDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  message: string;
}
