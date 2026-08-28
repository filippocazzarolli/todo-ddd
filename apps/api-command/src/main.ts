import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Senza questo, `onApplicationShutdown` non viene mai eseguito su SIGTERM e la
  // connessione al database resta aperta finche' il processo non muore. Gli e2e
  // non coprono il caso, perche' chiudono l'app a mano con `app.close()`.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3002);
}
void bootstrap();
