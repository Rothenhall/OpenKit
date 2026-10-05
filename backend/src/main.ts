import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module.js';
import { isOriginAllowed, trustProxySetting } from './common/http/origins.js';

try {
  process.loadEnvFile();
} catch {
  // no .env file, rely on the real environment
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useWebSocketAdapter(new WsAdapter(app));
  // Behind a proxy or load balancer, rate limits must see the visitor, not the proxy.
  app.set('trust proxy', trustProxySetting());
  app.disable('x-powered-by');
  app.use(
    (
      _req: unknown,
      res: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.enableCors({
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  });
  // Lets Docker and process managers stop the app cleanly, closing live calls.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
// CommonJS build: no top level await. Startup failures are logged and exit non zero.
bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
