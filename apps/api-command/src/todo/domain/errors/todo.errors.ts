/**
 * Errori di dominio: violazioni di invarianti dell'aggregato `Todo`.
 *
 * Sono volutamente ignoranti del trasporto — la mappatura su HTTP
 * è responsabilità del layer applicativo/infrastrutturale.
 */
export class TodoDomainError extends Error {}

export class TodoTitleRequiredError extends TodoDomainError {
  constructor() {
    super('Il titolo del todo è obbligatorio');
  }
}

export class TodoAlreadyDoneError extends TodoDomainError {
  constructor(public readonly todoId: string) {
    super(`Il todo ${todoId} è già stato completato`);
  }
}

export class TodoNotDoneError extends TodoDomainError {
  constructor(public readonly todoId: string) {
    super(`Il todo ${todoId} non è stato completato`);
  }
}

export class TodoDeletedError extends TodoDomainError {
  constructor(public readonly todoId: string) {
    super(`Il todo ${todoId} è stato cancellato`);
  }
}

export class TodoExpirationInvalidError extends TodoDomainError {
  constructor(public readonly value: string) {
    super(`La scadenza "${value}" non è una data e ora valida`);
  }
}

export class TodoExpirationInPastError extends TodoDomainError {
  constructor(public readonly value: string) {
    super(`La scadenza "${value}" è nel passato`);
  }
}
