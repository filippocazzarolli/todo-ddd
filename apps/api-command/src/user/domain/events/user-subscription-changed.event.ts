/*
 * `import type` e non un import normale: qui serve solo il tipo, e la classe
 * dell'evento non passa dalla DI, quindi la perdita di metadata descritta in
 * CLAUDE.md non la riguarda. È anche ciò che tiene il ciclo fra `aggregates/`
 * ed `events/` puramente a livello di tipi: dopo la compilazione non resta
 * nessun import fra i due moduli in questa direzione.
 */
import type { UserSubscription } from '../aggregates/user.aggregate';

/**
 * Emesso al passaggio da un piano di abbonamento a un altro.
 *
 * Porta entrambi i piani, a differenza di `TodoMarkedAsDoneEvent` che si
 * accontenta dell'id: là il nome dell'evento identifica da solo l'unica
 * transizione possibile, qui le coppie sono sei e il nome non ne distingue
 * nessuna.
 *
 * `from` non è ridondante nemmeno per un read model che tiene già il piano
 * corrente: rende l'evento autoesplicativo se la proiezione va ricostruita, e
 * soprattutto è ciò che permette a chi conosce un ordinamento dei piani di
 * dire se è stato un upgrade o un downgrade — informazione che il dominio del
 * lato write non possiede e non deve possedere.
 */
export class UserSubscriptionChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly from: UserSubscription,
    public readonly to: UserSubscription,
  ) {}
}
