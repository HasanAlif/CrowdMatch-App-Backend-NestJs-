import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { App, cert, deleteApp, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

// One FCM send batch. 500 is FCM's hard per-request ceiling.
export const FCM_BATCH_SIZE = 500;

export const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface BatchSendResult {
  successCount: number;
  failureCount: number;
  deadTokens: string[];
}

@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirebaseService.name);
  private app: App | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.configService.get<string>('firebase.projectId');
    const clientEmail = this.configService.get<string>('firebase.clientEmail');
    const privateKey = this.configService.get<string>('firebase.privateKey');

    if (!projectId || !clientEmail || !privateKey) {
      const message =
        'Firebase credentials missing — set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY';

      if (process.env.NODE_ENV === 'production') {
        throw new Error(message);
      }

      this.logger.warn(`${message}. Push delivery is DISABLED.`);
      return;
    }

    try {
      this.app = initializeApp(
        {
          credential: cert({ projectId, clientEmail, privateKey }),
        },
        'swapmess-notifications',
      );
      this.logger.log(`Firebase initialised for project ${projectId}`);
    } catch (err) {
      if (process.env.NODE_ENV === 'production') throw err;
      this.logger.warn(
        `Firebase initialisation failed — push disabled: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.app) {
      await deleteApp(this.app).catch(() => undefined);
      this.app = null;
    }
  }

  isEnabled(): boolean {
    return this.app !== null;
  }

  async sendBatch(
    tokens: string[],
    payload: PushPayload,
  ): Promise<BatchSendResult> {
    if (!this.app || tokens.length === 0) {
      return { successCount: 0, failureCount: tokens.length, deadTokens: [] };
    }

    try {
      const response = await getMessaging(this.app).sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: Object.fromEntries(
          Object.entries(payload.data ?? {}).map(([k, v]) => [
            k,
            typeof v === 'string' ? v : JSON.stringify(v ?? null),
          ]),
        ),
      });

      const deadTokens: string[] = [];
      response.responses.forEach((r, i) => {
        if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) {
          deadTokens.push(tokens[i]);
        }
      });

      return {
        successCount: response.successCount,
        failureCount: response.failureCount,
        deadTokens,
      };
    } catch (err) {
      this.logger.error(
        `FCM batch of ${tokens.length} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { successCount: 0, failureCount: tokens.length, deadTokens: [] };
    }
  }
}
