import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { TodoModule } from './todo/todo.module';
import { UserModule } from './user/user.module';

/**
 * Modulo radice: non ha codice proprio, solo composizione.
 *
 * `CqrsModule.forRoot()` sta qui e non in `TodoModule` perché è dichiarato
 * `global: true`: una registrazione sola mette `CommandBus`, `EventBus` e
 * `EventPublisher` a disposizione di tutti i moduli feature, presenti e
 * futuri.
 */
@Module({
  imports: [CqrsModule.forRoot(), TodoModule, UserModule],
})
export class AppModule {}
