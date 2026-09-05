import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { MatchingService } from './matching.service';

const CYCLE_INTERVAL_HOURS = 48;

@Injectable()
export class MatchingCron {
  private readonly logger = new Logger(MatchingCron.name);

  constructor(private readonly matchingService: MatchingService) {}

  @Cron('59 23 * * *', { name: 'match-generation-cycle' })
  async handleMatchCycle(): Promise<void> {
    this.logger.log('Match generation cron triggered — checking checkpoint…');

    try {
      const lastRunAt = await this.matchingService.getLastCycleRunAt();

      if (lastRunAt) {
        const hoursSinceLastRun =
          (Date.now() - lastRunAt.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastRun < CYCLE_INTERVAL_HOURS) {
          this.logger.log(
            `Only ${hoursSinceLastRun.toFixed(1)}h since last cycle — ` +
              `skipping (need ≥${CYCLE_INTERVAL_HOURS}h)`,
          );
          return;
        }
      } else {
        this.logger.log('No previous cycle found — running first cycle');
      }

      this.logger.log('Starting expire + regenerate cycle…');
      await this.matchingService.expireAndRegenerate();
      this.logger.log('Match generation cycle completed successfully');
    } catch (err) {
      this.logger.error('Match generation cycle failed', err);
    }
  }
}
