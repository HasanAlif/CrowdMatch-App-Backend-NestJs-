import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MessageService } from './message.service';
import { MessageGateway } from './message.gateway';
import { GetHistoryDto } from './dto/get-history.dto';
import { ReportUserDto } from './dto/report-user.dto';

/**
  Current order (top → bottom):
   1. GET  /messages/unread-count       ← static
   2. GET  /messages/conversations      ← static
   3. GET  /messages/blocked            ← static  ← NEW
   4. DELETE /messages/clear/:userId    ← static prefix "clear"
   5. POST /messages/block/:userId      ← static prefix "block"
   6. POST /messages/unblock/:userId    ← static prefix "unblock"
   7. POST /messages/report/:userId     ← static prefix "report"
   8. GET  /messages/:userId            ← dynamic  ← MUST BE LAST
 */
@UseGuards(AuthGuard)
@Controller('messages')
export class MessageController {
  constructor(
    private readonly messageService: MessageService,
    private readonly messageGateway: MessageGateway,
  ) {}

  // ── 1. GET /messages/unread-count ────
  @Get('unread-count')
  async getUnreadCount(@Request() req: any): Promise<{
    success: boolean;
    message: string;
    data: { unreadCount: number };
  }> {
    const userId = req.user.sub as string;
    const unreadCount = await this.messageService.getUnreadCount(userId);
    return {
      success: true,
      message: 'Unread count retrieved successfully',
      data: { unreadCount },
    };
  }

  // ── 2. GET /messages/conversations ──
  @Get('conversations')
  async getConversations(@Request() req: any): Promise<{
    success: boolean;
    message: string;
    data: unknown[];
  }> {
    const userId = req.user.sub as string;
    const conversations = await this.messageService.getConversations(userId);
    return {
      success: true,
      message: 'Conversations retrieved successfully',
      data: conversations,
    };
  }

  // ── 3. GET /messages/blocked ──
  @Get('blocked')
  async getBlockedUsers(@Request() req: any): Promise<{
    success: boolean;
    message: string;
    data: unknown[];
  }> {
    const userId = req.user.sub as string;
    const blocked = await this.messageService.getBlockedUsers(userId);
    return {
      success: true,
      message: 'Blocked users retrieved successfully',
      data: blocked,
    };
  }

  // ── 4. DELETE /messages/clear/:userId ──
  @Delete('clear/:userId')
  async clearChat(
    @Param('userId') otherId: string,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: { deletedCount: number };
  }> {
    const requesterId = req.user.sub as string;
    const deletedCount = await this.messageService.clearChat(
      requesterId,
      otherId,
    );

    // Notify the OTHER user via socket so their client can wipe local state.
    this.messageGateway.emitToRoom(otherId, 'chat_cleared', {
      byUserId: requesterId,
    });

    return {
      success: true,
      message: 'Chat cleared successfully',
      data: { deletedCount },
    };
  }

  // ── 5. POST /messages/block/:userId ──
  @Post('block/:userId')
  async blockUser(
    @Param('userId') targetId: string,
    @Request() req: any,
  ): Promise<{ success: boolean; message: string }> {
    const requesterId = req.user.sub as string;
    await this.messageService.blockUser(requesterId, targetId);
    return {
      success: true,
      message: 'User blocked successfully',
    };
  }

  // ── 6. POST /messages/unblock/:userId ──
  @Post('unblock/:userId')
  async unblockUser(
    @Param('userId') targetId: string,
    @Request() req: any,
  ): Promise<{ success: boolean; message: string }> {
    const requesterId = req.user.sub as string;
    await this.messageService.unblockUser(requesterId, targetId);
    return {
      success: true,
      message: 'User unblocked successfully',
    };
  }

  // ── 7. POST /messages/report/:userId ──
  @Post('report/:userId')
  async reportUser(
    @Param('userId') reportedId: string,
    @Body() dto: ReportUserDto,
    @Request() req: any,
  ): Promise<{ success: boolean; message: string }> {
    const reporterId = req.user.sub as string;
    await this.messageService.reportUser(
      reporterId,
      reportedId,
      dto.reason,
      dto.details,
    );
    return {
      success: true,
      message: 'User reported successfully',
    };
  }

  // ── 8. GET /messages/:userId ── MUST REMAIN LAST ───

  /**
    GET /messages/:userId?page=1&limit=50
    Returns paginated message history between the authenticated user and
    the user identified by :userId.
    Ordering: OLDEST FIRST within each page (chronological, top → bottom).
    Query params:
      page  — 1-indexed page number (default: 1)
      limit — messages per page    (default: 50, max: 100)
   */
  @Get(':userId')
  async getHistory(
    @Param('userId') otherId: string,
    @Query() query: GetHistoryDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      messages: unknown[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };
  }> {
    const userId = req.user.sub as string;
    const { messages, total, page, limit, totalPages } =
      await this.messageService.getHistory(
        userId,
        otherId,
        query.page,
        query.limit,
      );

    return {
      success: true,
      message: 'Message history retrieved successfully',
      data: {
        messages,
        pagination: { total, page, limit, totalPages },
      },
    };
  }
}
