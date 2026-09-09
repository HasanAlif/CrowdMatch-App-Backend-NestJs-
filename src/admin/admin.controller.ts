import {
  Body,
  Controller,
  Get,
  Logger,
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
import { RolesGuard } from 'src/auth/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/user/user.types';
import { AdminService } from './admin.service';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { NotificationTriggerService } from 'src/notification/notification-trigger.service';
import { BroadcastDto } from 'src/notification/dto/broadcast.dto';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly notificationTriggers: NotificationTriggerService,
  ) {}

  // GET /admin/profile
  @Get('profile')
  getAdminProfileInfoForUpdate(@Request() req: any) {
    const userId = req.user.sub as string;
    return this.adminService.getAdminProfileInfoForUpdate(userId);
  }

  // PATCH /admin/profile — update own fullName and/or picture (multipart/form-data)
  @Patch('profile')
  @UseInterceptors(
    FileInterceptor('picture', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  updateAdminProfile(
    @UploadedFile() picture: Express.Multer.File,
    @Body() dto: UpdateAdminProfileDto,
    @Request() req: any,
  ) {
    const userId = req.user.sub as string;
    return this.adminService.updateAdminProfileInfo(userId, dto, picture);
  }

  // POST /admin/notifications/broadcast — push to every user
  @Post('notifications/broadcast')
  broadcast(@Body() dto: BroadcastDto) {
    void this.notificationTriggers
      .broadcast(dto.title, dto.message)
      .then((stats) =>
        this.logger.log(
          `Broadcast dispatched: ${stats.usersProcessed} user(s), ` +
            `${stats.recordsCreated} record(s), ${stats.pushed} push(es), ` +
            `${stats.elapsedMs}ms`,
        ),
      )
      .catch((err) =>
        this.logger.error(
          'Broadcast failed',
          err instanceof Error ? err.stack : String(err),
        ),
      );

    return {
      success: true,
      message: 'Broadcast queued and is being delivered',
      data: { title: dto.title },
    };
  }
}
