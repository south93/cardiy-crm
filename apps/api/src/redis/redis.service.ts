import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Kết nối Redis dùng cho cache, hàng đợi, phiên đăng nhập. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.client.on('error', (err) => this.logger.warn(`Redis lỗi: ${err.message}`));
  }

  async ping(): Promise<boolean> {
    try {
      if (this.client.status === 'wait' || this.client.status === 'end') {
        await this.client.connect();
      }
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      this.client.disconnect();
    }
  }
}
