import {
  IsString,
  IsOptional,
  IsMongoId,
  MaxLength,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  IsNumber,
  Min,
  Max,
  IsBase64,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ImagePayloadDto {
  @IsString()
  @IsBase64()
  data: string;

  @IsString()
  mimeType: string;

  @IsNumber()
  @Min(1)
  @Max(10 * 1024 * 1024)
  sizeBytes: number;
}

export class SendMessageDto {
  @IsMongoId({ message: 'receiverId must be a valid MongoDB ObjectId' })
  receiverId: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000, { message: 'text must not exceed 5000 characters' })
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5, { message: 'A message may contain at most 5 images' })
  @ValidateNested({ each: true })
  @Type(() => ImagePayloadDto)
  images?: ImagePayloadDto[];

  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
