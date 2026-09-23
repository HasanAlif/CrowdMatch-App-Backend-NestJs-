import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/user/user.types';
import { AdminService } from './admin.service';
import { UpdateAdminProfileDto } from './dto/update-admin-profile.dto';
import { UpdateAdminPasswordDto } from './dto/update-admin-password.dto';
import { NotificationTriggerService } from 'src/notification/notification-trigger.service';
import { BroadcastDto } from 'src/notification/dto/broadcast.dto';
import { NotificationHistoryQueryDto } from 'src/notification/dto/notification-history-query.dto';
import { AdminDashboardService } from './admin-dashboard.service';
import { MonthYearQueryDto } from './dto/month-year-query.dto';
import { monthKeyToIndex } from 'src/common/dashboard-time';
import { AdminUserService } from './admin-user.service';
import {
  ListUsersQueryDto,
  SearchUsersQueryDto,
} from './dto/list-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { AdminVotingService } from './admin-voting.service';
import { VoteRecordsQueryDto } from './dto/vote-records-query.dto';
import { AdminMatchService } from './admin-match.service';
import { MatchRecordsQueryDto } from './dto/match-records-query.dto';
import { ReportRecordsQueryDto } from './dto/report-records-query.dto';

@Controller('admin')
@UseGuards(AuthGuard, RolesGuard)
@Roles(Role.Admin)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly adminService: AdminService,
    private readonly notificationTriggers: NotificationTriggerService,
    private readonly dashboard: AdminDashboardService,
    private readonly users: AdminUserService,
    private readonly voting: AdminVotingService,
    private readonly matches: AdminMatchService,
  ) {}

  // GET /admin/profile
  @Get('profile')
  getAdminProfileInfoForUpdate(@Request() req: any) {
    const userId = req.user.sub as string;
    return this.adminService.getAdminProfileInfoForUpdate(userId);
  }

  // PATCH /admin/profile
  @Patch('profile')
  async updateAdminProfile(
    @Body() dto: UpdateAdminProfileDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const userId = req.user.sub as string;
    const result = await this.adminService.updateAdminProfileInfo(userId, dto);

    if (result.data.requireReLogin) {
      res.clearCookie('accessToken');
    }

    return result;
  }

  // PATCH /admin/change-password — change own password, then end the session
  @Patch('change-password')
  async updateAdminPassword(
    @Body() dto: UpdateAdminPasswordDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const userId = req.user.sub as string;
    const result = await this.adminService.updateAdminPassword(
      userId,
      dto.currentPassword,
      dto.newPassword,
      dto.confirmNewPassword,
    );

    res.clearCookie('accessToken');

    return result;
  }

  // ── Notifications ──

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

  // GET /admin/notifications/history — past broadcasts, newest first
  @Get('notifications/history')
  async getNotificationHistory(@Query() query: NotificationHistoryQueryDto) {
    const { records, pagination } =
      await this.notificationTriggers.getNotificationHistory(query);
    return {
      success: true,
      message: 'Notification history retrieved successfully',
      data: records,
      pagination,
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

  // ── User Management ──

  // GET /admin/users?status=all|active|blocked&page=1&limit=50
  @Get('users')
  async listUsers(@Query() query: ListUsersQueryDto) {
    const data = await this.users.listUsers(query);
    return {
      success: true,
      message: 'Users retrieved successfully',
      data,
    };
  }

  // GET /admin/users/search?searchTerm=dylan&status=all&page=1&limit=50
  @Get('users/search')
  async searchUsers(@Query() query: SearchUsersQueryDto) {
    const data = await this.users.searchUsers(query);
    return {
      success: true,
      message: 'Users retrieved successfully',
      data,
    };
  }

  // PATCH /admin/users/:userId — { status: 'block' | 'unblock' }
  @Patch('users/:userId')
  async setUserStatus(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    const data = await this.users.setUserStatus(userId, dto.status);
    return {
      success: true,
      message:
        dto.status === 'block'
          ? 'User blocked successfully'
          : 'User unblocked successfully',
      data,
    };
  }

  // ── Voting Management ──

  // GET /admin/vote-count — lifetime totals, split by vote type
  @Get('vote-count')
  async getVoteCount() {
    const data = await this.voting.getVoteCount();
    return {
      success: true,
      message: 'Vote count retrieved successfully',
      data,
    };
  }

  // GET /admin/vote-distribution — positive/negative split, rates summing to 100
  @Get('vote-distribution')
  async getVoteDistribution() {
    const data = await this.voting.voteDistribution();
    return {
      success: true,
      message: 'Vote distribution retrieved successfully',
      data,
    };
  }

  // GET /admin/voting-trend — total votes per day for the last 7 days
  @Get('voting-trend')
  async getDailyVotingTrend() {
    const data = await this.voting.getDailyVotingTrend();
    return {
      success: true,
      message: 'Daily voting trend retrieved successfully',
      data,
    };
  }

  // GET /admin/vote-records?page=1&limit=50
  @Get('vote-records')
  async getVoteRecords(@Query() query: VoteRecordsQueryDto) {
    const { records, pagination } = await this.voting.getVoteRecords(query);
    return {
      success: true,
      message: 'Vote records retrieved successfully',
      data: records,
      pagination,
    };
  }

  // ── Match Management ──

  // GET /admin/match-count — total (approximate), active, removed
  @Get('match-count')
  async getMatchCount() {
    const data = await this.matches.getMatchCount();
    return {
      success: true,
      message: 'Match count retrieved successfully',
      data,
    };
  }

  // GET /admin/match-records?page=1&limit=50 — all matches, newest first
  @Get('match-records')
  async getMatchRecords(@Query() query: MatchRecordsQueryDto) {
    const { records, pagination } = await this.matches.getMatchRecords(query);
    return {
      success: true,
      message: 'Match records retrieved successfully',
      data: records,
      pagination,
    };
  }

  // DELETE /admin/matches/:matchId — takes the REAL _id, never the MCH- label.
  // Removes the match from the feed; never hard-deletes it.
  @Delete('matches/:matchId')
  async removeMatch(@Param('matchId') matchId: string) {
    const data = await this.matches.removeMatch(matchId);
    return {
      success: true,
      message: data.alreadyRemoved
        ? 'Match was already removed'
        : 'Match removed successfully',
      data,
    };
  }

  // ── Report Management ──

  // GET /admin/reports?page=1&limit=50 — user reports, newest first
  @Get('reports')
  async getReports(@Query() query: ReportRecordsQueryDto) {
    const { records, pagination } =
      await this.users.getReportManagementData(query);
    return {
      success: true,
      message: 'Reports retrieved successfully',
      data: records,
      pagination,
    };
  }
}
