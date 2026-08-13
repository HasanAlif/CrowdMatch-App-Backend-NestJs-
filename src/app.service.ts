import { Injectable } from '@nestjs/common';
import { LANDING_PAGE_TEMPLATE } from './utils/Template';

@Injectable()
export class AppService {
  getHello(): string {
    return LANDING_PAGE_TEMPLATE;
  }
}
