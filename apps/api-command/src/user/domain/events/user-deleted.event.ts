/**
 * Emesso quando l'utente viene cancellato.
 *
 * Non porta lo stato che l'utente aveva al momento della cancellazione: il
 * lato query lo ha già nella sua proiezione, e ricopiarlo qui renderebbe
 * l'evento un `UserSnapshotted` travestito.
 */
export class UserDeletedEvent {
  constructor(public readonly userId: string) {}
}
