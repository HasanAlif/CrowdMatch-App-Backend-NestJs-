import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
import { DeleteAccountDto } from './dto/delete-account.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { DeviceDto, resolveDevice } from '../auth/dto/device.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // POST /user/initial-complete-profile — onboarding step: fullName + age + photo
  @UseGuards(AuthGuard)
  @Post('initial-complete-profile')
  @UseInterceptors(
    FileInterceptor('photo', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  initialCompleteProfile(
    @UploadedFile() photo: Express.Multer.File,
    @Body() dto: InitialCompleteProfileDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub as string;
    return this.userService.initialCompleteProfile(userId, dto, photo);
  }

  // GET /user/profile — get authenticated user's profile
  @UseGuards(AuthGuard)
  @Get('profile')
  getProfile(@Request() req: any) {
    const userId = req.user.sub as string;
    return this.userService.getProfile(userId);
  }

  // PATCH /user/profile — update profile fields and/or picture (multipart/form-data)
  @UseGuards(AuthGuard)
  @Patch('profile')
  @UseInterceptors(
    FileInterceptor('picture', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
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

  // GET /user/account-status — account state + how deletion must be confirmed
  @UseGuards(AuthGuard)
  @Get('account-status')
  checkAccountStatus(@Request() req: any) {
    const userId = req.user.sub as string;
    return this.userService.checkAccountStatus(userId);
  }

  // DELETE /user/account — irreversibly delete the authenticated user's account
  @UseGuards(AuthGuard)
  @Delete('account')
  deleteAccount(@Body() dto: DeleteAccountDto, @Request() req: any) {
    const userId = req.user.sub as string;
    return this.userService.deleteAccount(userId, dto);
  }

  // POST /user/device — register or refresh this device's push token
  @UseGuards(AuthGuard)
  @Post('device')
  async registerDevice(@Body() dto: DeviceDto, @Request() req: any) {
    const device = resolveDevice(dto);
    if (!device) {
      throw new BadRequestException(
        'fcmToken, deviceId and platform are required',
      );
    }

    const userId = req.user.sub as string;
    await this.userService.upsertDevice(userId, device);

    return {
      success: true,
      message: 'Device registered successfully',
      data: { deviceId: device.deviceId, platform: device.platform },
    };
  }

  // PATCH /user/notification-preferences — toggle push categories
  @UseGuards(AuthGuard)
  @Patch('notification-preferences')
  async updateNotificationPreferences(
    @Body() dto: UpdateNotificationPreferencesDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub as string;
    const data = await this.userService.updateNotificationPreferences(
      userId,
      dto,
    );

    return {
      success: true,
      message: 'Notification preferences updated successfully',
      data,
    };
  }
}
