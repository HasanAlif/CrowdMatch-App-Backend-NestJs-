import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { MessageService } from './message.service';
import { CloudinaryService } from '../utils/cloudinary/cloudinary.service';
import { AccountStatus } from '../user/user.types';
import { SendMessageDto, ImagePayloadDto } from './dto/send-message.dto';
import { MessageDocument } from './schemas/message.schema';

// ── Constants ──
const MAX_TEXT_LENGTH = 5000;
const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE_MB = 10;
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024;
const MAX_TOTAL_PAYLOAD_BYTES = 25 * 1024 * 1024; // 25 MB total guard
const RATE_LIMIT_MAX = 20; // events per window
const RATE_LIMIT_WINDOW_MS = 10_000; // 10 seconds
const SOCKET_FILE_UPLOAD_CONCURRENCY = 2;

interface AuthenticatedSocket extends Socket {
  data: {
    userId: string;
  };
}

class SocketRateLimiter {
  private readonly timestamps = new Map<string, number[]>();

  check(socketId: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const events = (this.timestamps.get(socketId) ?? []).filter(
      (t) => t > windowStart,
    );

    if (events.length >= RATE_LIMIT_MAX) return false;

    events.push(now);
    this.timestamps.set(socketId, events);
    return true;
  }

  remove(socketId: string): void {
    this.timestamps.delete(socketId);
  }
}

// ── Gateway ──
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : true,
    credentials: true,
  },
  maxHttpBufferSize: 30 * 1024 * 1024,
})
export class MessageGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(MessageGateway.name);

  private readonly activeSockets = new Map<string, Set<string>>();

  private readonly rateLimiter = new SocketRateLimiter();

  constructor(
    private readonly messageService: MessageService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      const token = this.extractToken(socket);
      if (!token) {
        socket.emit('error', { message: 'Authentication token is required' });
        socket.disconnect(true);
        return;
      }

      let payload: { sub: string };
      try {
        payload = await this.jwtService.verifyAsync<{ sub: string }>(token, {
          secret: this.configService.get<string>('jwt.secret'),
        });
      } catch {
        socket.emit('error', { message: 'Invalid or expired token' });
        socket.disconnect(true);
        return;
      }

      const user = await this.messageService.findUserForAuth(payload.sub);
      if (!user) {
        socket.emit('error', { message: 'User not found' });
        socket.disconnect(true);
        return;
      }

      if (user.accountStatus !== AccountStatus.Active) {
        socket.emit('error', {
          message: 'Account is not active',
          accountStatus: user.accountStatus,
        });
        socket.disconnect(true);
        return;
      }

      const userId = String(user._id);
      socket.data.userId = userId;

      await socket.join(userId);

      const wasOffline = !this.activeSockets.has(userId);
      if (!this.activeSockets.has(userId)) {
        this.activeSockets.set(userId, new Set());
      }
      this.activeSockets.get(userId)!.add(socket.id);

      if (wasOffline) {
        await this.messageService.setOnlineStatus(userId, true);
        this.server.emit('user_online', { userId });
        this.logger.log(`User ${userId} came online`);
      }

      this.logger.debug(
        `Socket ${socket.id} connected for user ${userId} (` +
          `${this.activeSockets.get(userId)!.size} active socket(s))`,
      );
    } catch (err) {
      this.logger.error('Unexpected error during socket connection', err);
      socket.emit('error', { message: 'Internal server error' });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    this.rateLimiter.remove(socket.id);

    const userId = socket.data?.userId;
    if (!userId) return;

    const sockets = this.activeSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.activeSockets.delete(userId);
        await this.messageService.setOnlineStatus(userId, false);
        this.server.emit('user_offline', { userId });
        this.logger.log(`User ${userId} went offline`);
      }
    }

    this.logger.debug(`Socket ${socket.id} disconnected for user ${userId}`);
  }

  // ── Permission check ──
  private async canUsersChat(
    senderId: string,
    receiverId: string,
  ): Promise<boolean> {
    return this.messageService.canUsersChat(senderId, receiverId);
  }

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<void> {
    // Rate limit first
    if (!this.rateLimiter.check(socket.id)) {
      socket.emit('error', {
        event: 'send_message',
        message: `Rate limit exceeded: at most ${RATE_LIMIT_MAX} messages per ${RATE_LIMIT_WINDOW_MS / 1000}s`,
      });
      return;
    }

    const senderId = socket.data.userId;

    // Validate payload shape with class-validator.
    const dto = plainToInstance(SendMessageDto, rawPayload);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errors.length > 0) {
      socket.emit('error', {
        event: 'send_message',
        message: 'Invalid payload',
        details: errors.map((e) =>
          Object.values(e.constraints ?? {}).join(', '),
        ),
      });
      return;
    }

    // Must have text and/or at least one image.
    if (!dto.text && (!dto.images || dto.images.length === 0)) {
      socket.emit('error', {
        event: 'send_message',
        message: 'A message must contain text or at least one image',
      });
      return;
    }

    // Text length guard.
    if (dto.text && dto.text.length > MAX_TEXT_LENGTH) {
      socket.emit('error', {
        event: 'send_message',
        message: `Text exceeds ${MAX_TEXT_LENGTH} character limit`,
      });
      return;
    }

    // Image count guard.
    if (dto.images && dto.images.length > MAX_IMAGES) {
      socket.emit('error', {
        event: 'send_message',
        message: `Too many images: maximum is ${MAX_IMAGES}`,
      });
      return;
    }

    // Per-image and total-payload size guard — done BEFORE any upload starts.
    if (dto.images && dto.images.length > 0) {
      let totalBytes = 0;
      for (const img of dto.images) {
        if (img.sizeBytes > MAX_IMAGE_SIZE_BYTES) {
          socket.emit('error', {
            event: 'send_message',
            message: `Each image must not exceed ${MAX_IMAGE_SIZE_MB} MB`,
          });
          return;
        }
        totalBytes += img.sizeBytes;
      }
      if (totalBytes > MAX_TOTAL_PAYLOAD_BYTES) {
        socket.emit('error', {
          event: 'send_message',
          message: 'Total image payload exceeds 25 MB limit',
        });
        return;
      }
    }

    // Permission check.
    const allowed = await this.canUsersChat(senderId, dto.receiverId);
    if (!allowed) {
      socket.emit('error', {
        event: 'send_message',
        message: 'You are not permitted to message this user',
      });
      return;
    }

    // Upload images with bounded concurrency (SOCKET_FILE_UPLOAD_CONCURRENCY=2).
    let uploadedImages: { url: string; publicId: string }[] = [];
    if (dto.images && dto.images.length > 0) {
      try {
        uploadedImages = await this.uploadWithConcurrency(
          dto.images,
          SOCKET_FILE_UPLOAD_CONCURRENCY,
        );
      } catch (err) {
        this.logger.error(`Image upload failed for socket ${socket.id}`, err);
        socket.emit('error', {
          event: 'send_message',
          message: 'Image upload failed — please try again',
        });
        return;
      }
    }

    let savedMessage: MessageDocument;
    try {
      savedMessage = await this.messageService.saveMessage({
        senderId,
        receiverId: dto.receiverId,
        text: dto.text,
        images: uploadedImages,
        clientMessageId: dto.clientMessageId,
      });
    } catch (err) {
      this.logger.error('Failed to persist message', err);
      socket.emit('error', {
        event: 'send_message',
        message: 'Failed to save message — please try again',
      });
      return;
    }

    const payload = savedMessage.toObject();

    // Emit to the receiver's room (live delivery if connected).
    this.server.to(dto.receiverId).emit('new_message', payload);

    // Acknowledge back to the sender.
    socket.emit('message_sent', payload);
  }

  @SubscribeMessage('typing')
  handleTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { receiverId: string },
  ): void {
    if (!body?.receiverId) return;
    this.server.to(body.receiverId).emit('typing', {
      senderId: socket.data.userId,
    });
  }

  @SubscribeMessage('stop_typing')
  handleStopTyping(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { receiverId: string },
  ): void {
    if (!body?.receiverId) return;
    this.server.to(body.receiverId).emit('stop_typing', {
      senderId: socket.data.userId,
    });
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() body: { senderId: string },
  ): Promise<void> {
    if (!body?.senderId) return;
    const viewerId = socket.data.userId;
    const count = await this.messageService.markRead(viewerId, body.senderId);

    // Notify the original sender that their messages were seen.
    this.server.to(body.senderId).emit('messages_read', {
      byUserId: viewerId,
      count,
    });

    // Ack to the viewer.
    socket.emit('mark_read_ack', { markedCount: count });
  }

  @SubscribeMessage('get_online_users')
  async handleGetOnlineUsers(
    @ConnectedSocket() socket: AuthenticatedSocket,
  ): Promise<void> {
    const users = await this.messageService.getOnlineUsers();
    socket.emit('online_users', { users });
  }

  // ── Public API (called by REST controller) ──
  emitToRoom(room: string, event: string, payload: unknown): void {
    this.server.to(room).emit(event, payload);
  }

  // ── Private helpers ──
  private extractToken(socket: Socket): string | undefined {
    // 1. Cookie
    const cookieHeader = socket.handshake.headers.cookie;
    if (cookieHeader) {
      const cookies = cookieHeader
        .split(';')
        .reduce<Record<string, string>>((acc, c) => {
          const [key, val] = c.trim().split('=');
          if (key && val) acc[key] = decodeURIComponent(val);
          return acc;
        }, {});
      if (cookies.accessToken) return cookies.accessToken;
    }

    // 2. Authorization: Bearer header
    const authHeader = socket.handshake.headers.authorization;
    if (authHeader) {
      const [type, token] = authHeader.split(' ');
      if (type === 'Bearer' && token) return token;
    }

    // 3. Explicit auth object (socket.io client: { auth: { token: '...' } })
    const authObj = socket.handshake.auth;
    if (typeof authObj?.token === 'string' && authObj.token) {
      return authObj.token;
    }

    return undefined;
  }

  private async uploadWithConcurrency(
    images: ImagePayloadDto[],
    concurrency: number,
  ): Promise<{ url: string; publicId: string }[]> {
    const results: { url: string; publicId: string }[] = new Array(
      images.length,
    );
    let index = 0;

    const worker = async (): Promise<void> => {
      while (index < images.length) {
        const current = index++;
        const img = images[current];
        // Strip data-URI prefix if the client accidentally included it.
        const base64 = img.data.includes(',')
          ? img.data.split(',')[1]
          : img.data;
        const buffer = Buffer.from(base64, 'base64');
        results[current] = await this.cloudinaryService.uploadImage(
          buffer,
          'message-images',
        );
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(concurrency, images.length) }, () =>
        worker(),
      ),
    );

    return results;
  }
}
