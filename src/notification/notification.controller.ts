import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { NotificationReadService } from './notification-read.service';
import { PaginationDto } from '../matching/dto/pagination.dto';

/**
 * ROUTE ORDERING IS LOAD-BEARING.
 * Current order (top -> bottom):
 *   1. GET   /notifications/unread-count   <- static
 *   2. PATCH /notifications/read-all       <- static
 *   3. GET   /notifications                <- root, paginated list
 *   4. GET   /notifications/:id            <- dynamic
 *   5. PATCH /notifications/:id/read       <- dynamic
 */
@UseGuards(AuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly readService: NotificationReadService) {}

  // -- 1. GET /notifications/unread-count
  @Get('unread-count')
  async getUnreadCount(@Request() req: any): Promise<{
    success: boolean;
    message: string;
    data: { unreadCount: number };
  }> {
    const userId = req.user.sub as string;
    const unreadCount = await this.readService.unreadCount(userId);
    return {
      success: true,
      message: 'Unread count retrieved successfully',
      data: { unreadCount },
    };
  }

  // -- 2. PATCH /notifications/read-all
  @Patch('read-all')
  async markAllRead(@Request() req: any): Promise<{
    success: boolean;
    message: string;
    data: { modifiedCount: number };
  }> {
    const userId = req.user.sub as string;
    const modifiedCount = await this.readService.markAllRead(userId);
    return {
      success: true,
      message: 'All notifications marked as read',
      data: { modifiedCount },
    };
  }

  // -- 3. GET /notifications -- paginated list, newest first --
  @Get()
  async list(
    @Query() query: PaginationDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      notifications: unknown[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };
  }> {
    const userId = req.user.sub as string;
    const { notifications, total, page, limit, totalPages } =
      await this.readService.list(userId, query.page, query.limit);

    return {
      success: true,
      message: 'Notifications retrieved successfully',
      data: {
        notifications,
        pagination: { total, page, limit, totalPages },
      },
    };
  }

  // -- 4. GET /notifications/:id -- detail, and marks read atomically --
  @Get(':id')
  async getOne(
    @Param('id') id: string,
    @Request() req: any,
  ): Promise<{ success: boolean; message: string; data: unknown }> {
    const userId = req.user.sub as string;
    const data = await this.readService.getOneAndMarkRead(userId, id);
    return {
      success: true,
      message: 'Notification retrieved successfully',
      data,
    };
  }

  // -- 5. PATCH /notifications/:id/read
  @Patch(':id/read')
  async markRead(
    @Param('id') id: string,
    @Request() req: any,
  ): Promise<{ success: boolean; message: string; data: unknown }> {
    const userId = req.user.sub as string;
    const data = await this.readService.markRead(userId, id);
    return {
      success: true,
      message: 'Notification marked as read',
      data,
    };
  }
}
