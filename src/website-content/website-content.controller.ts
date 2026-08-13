import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from 'src/auth/auth.guard';
import { RolesGuard } from 'src/auth/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { Role } from 'src/user/user.types';
import { WebsiteContentService } from './website-content.service';
import { ContentType } from './website-content.types';
import { UpdateContentDto } from './dto/update-content.dto';

@Controller('website-content')
export class WebsiteContentController {
  constructor(private readonly websiteContentService: WebsiteContentService) {}

  // GET /website-content/:type — public, returns stub if not yet created
  @Get(':type')
  getContentByType(
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
  ) {
    return this.websiteContentService.getContentByType(type);
  }

  // PATCH /website-content/:type — admin upsert
  @UseGuards(AuthGuard, RolesGuard)
  @Roles(Role.Admin)
  @Patch(':type')
  createOrUpdateContent(
    @Param('type', new ParseEnumPipe(ContentType)) type: ContentType,
    @Body() dto: UpdateContentDto,
  ) {
    return this.websiteContentService.createOrUpdateContent(type, dto.content);
  }
}
