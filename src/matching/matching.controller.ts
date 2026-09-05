import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MatchingService } from './matching.service';
import { PaginationDto } from './dto/pagination.dto';
import { DecisionDto } from './dto/decision.dto';
import { CastVoteDto } from './dto/cast-vote.dto';

/**
 * Route ordering:
 *   1. GET  /matching/mine           ← static (must be before :id)
 *   2. GET  /matching/mine/accepted  ← static
 *   3. GET  /matching                ← root — voting feed
 *   4. PATCH /matching/:id/decision
 *   5. POST /matching/vote?matchId=<id>
 */
@UseGuards(AuthGuard)
@Controller('matching')
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  // ── 1. GET /matching/mine — my matches ──
  @Get('mine')
  async getMyMatches(
    @Query() query: PaginationDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      matches: unknown[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };
  }> {
    const userId = req.user.sub as string;
    const { matches, total, page, limit, totalPages } =
      await this.matchingService.getMyMatches(userId, query.page, query.limit);

    return {
      success: true,
      message: 'Your matches retrieved successfully',
      data: {
        matches,
        pagination: { total, page, limit, totalPages },
      },
    };
  }

  // ── 2. GET /matching/mine/accepted — people I accepted ──
  @Get('mine/accepted')
  async getMyAcceptedMatches(
    @Query() query: PaginationDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      matches: unknown[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };
  }> {
    const userId = req.user.sub as string;
    const { matches, total, page, limit, totalPages } =
      await this.matchingService.getMyAcceptedMatches(
        userId,
        query.page,
        query.limit,
      );

    return {
      success: true,
      message: 'Your accepted matches retrieved successfully',
      data: {
        matches,
        pagination: { total, page, limit, totalPages },
      },
    };
  }

  // ── 3. GET /matching — public voting feed ──
  @Get()
  async getVotingFeed(
    @Query() query: PaginationDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: {
      matches: unknown[];
      pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
      };
    };
  }> {
    const userId = req.user.sub as string;
    const { matches, total, page, limit, totalPages } =
      await this.matchingService.getVotingFeed(userId, query.page, query.limit);

    return {
      success: true,
      message: 'Voting feed retrieved successfully',
      data: {
        matches,
        pagination: { total, page, limit, totalPages },
      },
    };
  }

  // ── 4. PATCH /matching/:id/decision ──
  @Patch(':id/decision')
  async updateDecision(
    @Param('id') matchId: string,
    @Body() dto: DecisionDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: { matchId: string; myDecision: string; matchStatus: string };
  }> {
    const userId = req.user.sub as string;
    const result = await this.matchingService.updateDecision(
      matchId,
      userId,
      dto.decision,
    );

    return {
      success: true,
      message: 'Decision updated successfully',
      data: result,
    };
  }

  // ── 5. POST /matching/vote?matchId=<id> ──
  @Post('vote')
  async castVote(
    @Query('matchId') matchId: string,
    @Body() dto: CastVoteDto,
    @Request() req: any,
  ): Promise<{
    success: boolean;
    message: string;
    data: { voteId: string; matchId: string; voteType: string };
  }> {
    const userId = req.user.sub as string;
    const result = await this.matchingService.castVote(
      matchId,
      userId,
      dto.vote,
    );

    return {
      success: true,
      message: 'Vote cast successfully',
      data: result,
    };
  }
}
