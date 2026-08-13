import { IsNotEmpty, IsString, IsEmail, MinLength } from 'class-validator';
import { Match } from '../../utils/match.decorator';

export class RegisterWithEmailDto {
  @IsNotEmpty()
  @IsString()
  fullName: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(6)
  @Match('password')
  confirmPassword: string;
}

export { RegisterWithEmailDto as RegisterDto };
