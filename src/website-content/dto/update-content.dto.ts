import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateContentDto {
  @IsNotEmpty({ message: 'content must not be empty' })
  @IsString()
  content: string;
}
