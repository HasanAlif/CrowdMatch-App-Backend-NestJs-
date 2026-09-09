import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { NotificationTriggerService } from './notification-trigger.service';

export const BOOST_SWEEP_CRON = '*/2 * * * *';

@Injectable()
export class NotificationCron {
  private readonly logger = new Logger(NotificationCron.name);

  constructor(private readonly triggers: NotificationTriggerService) {}

  @Cron('0 19 * * *', {
    name: 'daily-activity-reminder',
    timeZone: 'America/New_York',
  })
  async handleDailyReminder(): Promise<void> {
    this.logger.log('Daily activity reminder cron triggered');

    try {
      const stats = await this.triggers.sendDailyActivityReminder();
      this.logger.log(
        `Daily activity reminder finished: ${stats.notified} notified of ` +
          `${stats.candidates} candidate(s), ${stats.pushed} push(es), ` +
          `${stats.elapsedMs}ms`,
      );
    } catch (err) {
      this.logger.error('Daily activity reminder failed', err);
    }
  }

  @Cron(BOOST_SWEEP_CRON, { name: 'boost-end-announcer' })
  async handleBoostEndSweep(): Promise<void> {
    try {
      const stats = await this.triggers.sweepEndedBoosts();
      if (stats.claimed > 0) {
        this.logger.log(
          `Boost-end sweep: ${stats.claimed} ended, ${stats.recordsCreated} ` +
            `record(s), ${stats.pushed} push(es), ${stats.elapsedMs}ms`,
        );
      }
    } catch (err) {
      this.logger.error('Boost-end sweep failed', err);
    }
  }
}
