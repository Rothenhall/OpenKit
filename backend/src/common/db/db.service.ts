import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import pg from 'pg';

/**
 * Postgres (Neon) access. Lazy: the pool opens on first use, so the API
 * still starts and every other tool still works when `DATABASE_URL` is
 * missing or the database is briefly down. Only features that need the
 * database report "unavailable".
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool?: pg.Pool;

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<T>> {
    try {
      return await this.connection().query<T>(text, params);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(`Database query failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException(
        'We could not save that right now. Please try again in a moment.',
      );
    }
  }

  private connection(): pg.Pool {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new ServiceUnavailableException('The database is not configured');
    }
    if (!this.pool) {
      this.pool = new pg.Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 8_000,
      });
      // An idle client dropped by the server must not crash the process.
      this.pool.on('error', (error) =>
        this.logger.warn(`Idle database client error: ${error.message}`),
      );
    }
    return this.pool;
  }

  async onModuleDestroy() {
    await this.pool?.end().catch(() => undefined);
  }
}
