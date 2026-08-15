import {
  Body,
  Controller,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AuthGuard } from 'src/auth/auth.guard';
import { UserService } from './user.service';
import { InitialCompleteProfileDto } from './dto/initial-complete-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // POST /user/initial-complete-profile — onboarding step: fullName + age + photo
  @UseGuards(AuthGuard)
  @Post('initial-complete-profile')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  initialCompleteProfile(
    @UploadedFile() photo: Express.Multer.File,
    @Body() dto: InitialCompleteProfileDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub as string;
    return this.userService.initialCompleteProfile(userId, dto, photo);
  }

  // PATCH /user/profile — update profile fields and/or picture (multipart/form-data)
  @UseGuards(AuthGuard)
  @Patch('profile')
  @UseInterceptors(FileInterceptor('picture', { storage: memoryStorage() }))
  updateProfile(
    @UploadedFile() picture: Express.Multer.File,
    @Body() dto: UpdateProfileDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub as string;
    return this.userService.updateProfile(userId, dto, picture);
  }

  // PATCH /user/change-password — change authenticated user's password
  @UseGuards(AuthGuard)
  @Patch('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Request() req: any) {
    const userId = req.user.sub as string;
    return this.userService.changePassword(userId, dto);
  }
}
