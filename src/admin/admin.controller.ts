import {
  Body,
  Controller,
  Get,
  Logger,
  Patch,
  Post,
  Query,
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
import { AdminDashboardService } from './admin-dashboard.service';
import { MonthYearQueryDto } from './dto/month-year-query.dto';
import { monthKeyToIndex } from 'src/common/dashboard-time';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly notificationTriggers: NotificationTriggerService,
    private readonly dashboard: AdminDashboardService,
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

  // ── Dashboard Overview ──

  // GET /admin/statistics — headline counts with 7d-vs-prior-7d growth
  @Get('statistics')
  async getUserStatistics() {
    const data = await this.dashboard.getUserStatistics();
    return {
      success: true,
      message: 'User statistics retrieved successfully',
      data,
    };
  }

  // GET /admin/user-growth?month=jun&year=2026 — new registrations per day
  @Get('user-growth')
  async getDailyUserGrowth(@Query() query: MonthYearQueryDto) {
    const data = await this.dashboard.getDailyUserGrowth(
      monthKeyToIndex(query.month),
      query.year,
    );
    return {
      success: true,
      message: 'Daily user growth retrieved successfully',
      data,
    };
  }

  // GET /admin/match-trend?month=jun&year=2026 — matches created per day
  @Get('match-trend')
  async getMatchCreationTrend(@Query() query: MonthYearQueryDto) {
    const data = await this.dashboard.getMatchCreationTrend(
      monthKeyToIndex(query.month),
      query.year,
    );
    return {
      success: true,
      message: 'Match creation trend retrieved successfully',
      data,
    };
  }

  // GET /admin/recent-activity — last 24h of feed events, newest first
  @Get('recent-activity')
  async getRecentActivity() {
    const data = await this.dashboard.getRecentActivity();
    return {
      success: true,
      message: 'Recent activity retrieved successfully',
      data,
    };
  }
}
