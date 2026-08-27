import { AggregateRoot } from '@nestjs/cqrs';

import {
  UserAlreadySubscribedError,
  UserDeletedError,
  UserNameField,
  UserNameRequiredError,
} from '../errors/user.errors';
import { UserCreatedEvent } from '../events/user-created.event';
import { UserDeletedEvent } from '../events/user-deleted.event';
import { UserSubscriptionChangedEvent } from '../events/user-subscription-changed.event';
import { UserChanges, UserUpdatedEvent } from '../events/user-updated.event';
import { Email } from '../value-objects/email.value-object';

/**
 * I piani esistenti, come tupla `as const` da cui si deriva il tipo.
 *
 * Una tupla e non solo la union perché il tipo non sopravvive alla
 * compilazione, e al confine HTTP serve la lista *a runtime*: `@IsIn` nel DTO
 * la legge da qui, così la verità resta una sola. Scrivere l'elenco due volte
 * — union nel dominio, array nel DTO — è il tipo di duplicazione che si
 * disallinea al primo piano aggiunto, e in silenzio.
 *
 * L'ordine degli elementi **non** è un dato del dominio: qui non esiste un
 * "piano superiore", e la posizione nell'array è solo l'ordine in cui li
 * abbiamo scritti. Finché nessuna regola dipende dal confronto fra piani,
 * dichiarare una gerarchia significherebbe inventare un invariante che non
 * c'è — ed è la ragione per cui non ci sono `upgrade` e `downgrade` ma un solo
 * `changeSubscription`.
 */
export const USER_SUBSCRIPTIONS = ['free', 'standard', 'pro'] as const;

/**
 * Piano di abbonamento dell'utente. Union di string literal e non `enum`, come
 * `TodoStatus`: i valori sono già la loro rappresentazione persistita, quindi
 * non serve un livello di indirezione tra nome e valore.
 */
export type UserSubscription = (typeof USER_SUBSCRIPTIONS)[number];

/**
 * Forma completa e normalizzata di un utente: `CreateUserProps` è il suo
 * sottoinsieme grezzo.
 *
 * Come `TodoProps`, ha due ruoli — stato interno dell'aggregato e contratto
 * verso la persistenza (`snapshot()` lo produce, `rehydrate()` lo consuma) — e
 * restano un tipo solo perché oggi le due forme coincidono. Si divideranno
 * quando la persistenza vera vorrà `email` come stringa invece del Value
 * Object.
 *
 * Nessun campo opzionale: un utente senza email, senza nome o senza piano non
 * è un utente incompleto, è un utente che non esiste.
 */
export interface UserProps {
  userId: string;
  /**
   * È il Value Object e non la stringa: l'invariante "indirizzo valido e
   * normalizzato" vive dentro `Email`, quindi uno stato che compila è già uno
   * stato valido. Immutabile, perciò può stare nello stato e uscire nello
   * `snapshot()` senza copia.
   */
  email: Email;
  firstName: string;
  lastName: string;
  /**
   * Piano attivo. Sempre presente nello stato, anche quando il chiamante non
   * l'ha scelto: il default è deciso dall'aggregato, non rappresentato come
   * assenza.
   */
  subscription: UserSubscription;
  /**
   * Cancellazione logica. Non è un valore di `UserSubscription` perché è
   * ortogonale al piano: si cancella sia un utente `free` sia uno `pro`, e il
   * piano che aveva resta un'informazione valida — alla fatturazione serve
   * anche dopo.
   */
  deleted: boolean;
}

/** Dati grezzi accettati dalla factory: nessun campo derivato o di lifecycle. */
export interface CreateUserProps {
  /**
   * Identità assegnata dal chiamante, come il `todoId`: il dominio non genera
   * ID, così `create` resta una funzione pura e testabile senza mock. La porta
   * che la produce (`UserIdGenerator`, gemella di `TodoIdGenerator`) arriverà
   * con il primo handler che ne ha bisogno.
   */
  userId: string;
  /** Indirizzo grezzo: a validarlo e normalizzarlo è `Email`. */
  email: string;
  firstName: string;
  lastName: string;
  /**
   * Piano iniziale, `free` se assente: chi si registra senza scegliere è sul
   * piano gratuito, non su nessun piano. Stesso trattamento di `important` in
   * `CreateTodoProps` — un default che il dominio conosce e che il chiamante
   * non è costretto a ripetere.
   */
  subscription?: UserSubscription;
}

/**
 * Campi modificabili di un utente esistente, entrambi opzionali: l'update è
 * parziale, non una sostituzione.
 *
 * Due stati per ogni campo e non tre come in `UpdateTodoProps`: chiave assente
 * significa "non toccare", un valore significa "assegna", e non esiste
 * "azzera" perché né il nome né il cognome sono azzerabili — un utente senza
 * nome non esiste. Per questo nessuno dei due ammette `null`.
 *
 * L'email non è qui, e non per dimenticanza. Cambiarla è un'operazione con una
 * precondizione che l'aggregato non può verificare (l'unicità fra utenti),
 * quindi vuole un comando proprio — `changeEmail` — dove quel controllo sia
 * visibile. Infilarla in un update parziale la farebbe passare per una
 * modifica come le altre e nasconderebbe la verifica di unicità dentro un
 * metodo che a volte non cambia niente. Il piano, allo stesso modo, ha già la
 * sua transizione dedicata: `changeSubscription`.
 */
export interface UpdateUserProps {
  firstName?: string;
  lastName?: string;
}

/**
 * Aggregate Root dell'utente.
 *
 * Ciclo di vita: nessuna sequenza di stati, ma due assi indipendenti — il
 * piano, che cambia liberamente con `changeSubscription`, e `deleted`, stato
 * terminale ortogonale che congela ogni ulteriore transizione. `changeEmail`
 * arriverà con il comando che la richiede.
 *
 * L'unicità dell'email **non** è un invariante di questo aggregato, e non può
 * esserlo: verificarla richiede di guardare gli altri utenti, cioè fuori dal
 * confine transazionale dell'aggregato. Appartiene al layer applicativo, con
 * l'ultima parola a un vincolo `UNIQUE` in persistenza — esattamente come
 * l'unicità dell'id, che `TodoRepository.add` fa rispettare all'adapter e non
 * all'aggregato.
 */
export class User extends AggregateRoot {
  private constructor(private props: UserProps) {
    super();
  }

  /**
   * Factory: crea un utente nuovo e registra `UserCreatedEvent`.
   *
   * Da usare solo per utenti che nascono ora. Per riportare in memoria un
   * utente già persistito serve `rehydrate`, che non emette eventi.
   *
   * L'ordine di validazione è email, nome, cognome, e conta: i tre controlli
   * sono indipendenti, quindi con più campi invalidi il primo errore vince.
   * Fissarlo qui rende l'errore prevedibile per chi lo mappa a valle, invece
   * di dipendere da come sono disposte le assegnazioni. Il piano non entra
   * nell'ordine perché non ha niente da validare: il tipo lo ha già fatto.
   */
  static create(props: CreateUserProps): User {
    const email = Email.create(props.email);
    const firstName = normalizeName(props.firstName, 'firstName');
    const lastName = normalizeName(props.lastName, 'lastName');
    const subscription = props.subscription ?? 'free';

    const user = new User({
      userId: props.userId,
      email,
      firstName,
      lastName,
      subscription,
      deleted: false,
    });

    user.apply(
      new UserCreatedEvent(
        props.userId,
        email.toString(),
        firstName,
        lastName,
        subscription,
      ),
    );

    return user;
  }

  /**
   * Ricostruisce l'aggregato da uno stato persistito, senza emettere eventi:
   * quei fatti sono già accaduti.
   *
   * Non rinormalizza né rivalida: `UserProps` è già la forma normalizzata, e
   * l'`Email` in ingresso è un VO che non può esistere invalido. Un nome vuoto
   * in persistenza non è un input di dominio da respingere, è un dato rotto —
   * e nasconderlo dietro un errore di invariante al caricamento lo renderebbe
   * indistinguibile da una richiesta malformata.
   *
   * Copia le props invece di adottarle: lo stato dell'aggregato non deve
   * restare aliasato all'oggetto del chiamante.
   */
  static rehydrate(props: UserProps): User {
    return new User({ ...props });
  }

  /**
   * Aggiorna nome e cognome ed emette `UserUpdatedEvent` con il solo delta.
   *
   * Unico vincolo di stato: l'utente non deve essere cancellato.
   *
   * No-op silenzioso se nessun valore cambia davvero: nessuna mutazione,
   * nessun evento. È la stessa scelta di `Todo.update` e l'opposto di
   * `changeSubscription`, che invece lancia — e la differenza non è
   * incoerenza. Qui l'input è un insieme sparso di campi, dove "niente è
   * cambiato" è una conseguenza innocua di cosa il chiamante ha spedito;
   * là è una transizione su un asse solo, chiesta esplicitamente, dietro cui
   * c'è un pagamento.
   */
  update(props: UpdateUserProps): void {
    this.ensureNotDeleted();

    /*
     * Si valida tutto prima di mutare qualsiasi cosa: `normalizeName` può
     * lanciare, e mutando strada facendo un nome valido con un cognome vuoto
     * lascerebbe in memoria un aggregato a metà, in uno stato che nessun
     * comando ha chiesto. Il repository non lo salverebbe, ma l'istanza è già
     * stata corrotta.
     */
    const firstName =
      props.firstName === undefined
        ? undefined
        : normalizeName(props.firstName, 'firstName');
    const lastName =
      props.lastName === undefined
        ? undefined
        : normalizeName(props.lastName, 'lastName');

    const changes: UserChanges = {};

    if (firstName !== undefined && firstName !== this.props.firstName) {
      this.props.firstName = firstName;
      changes.firstName = firstName;
    }

    if (lastName !== undefined && lastName !== this.props.lastName) {
      this.props.lastName = lastName;
      changes.lastName = lastName;
    }

    if (Object.keys(changes).length === 0) {
      return;
    }

    this.apply(new UserUpdatedEvent(this.props.userId, changes));
  }

  /**
   * Sposta l'utente su un altro piano ed emette `UserSubscriptionChangedEvent`.
   *
   * Un solo metodo e non la coppia `upgrade`/`downgrade`: quella distinzione
   * richiede un ordinamento fra i piani che `UserSubscription` non dichiara
   * (vedi il suo commento). Il verso resta comunque ricostruibile, perché
   * l'evento porta anche il piano di partenza.
   *
   * **Non è idempotente**: passare al piano su cui si è già lancia
   * `UserAlreadySubscribedError`, come `markAsDone` su un todo già completato.
   * Qui la scelta pesa più che su un todo — dietro un cambio piano c'è un
   * pagamento, e assorbire in silenzio una richiesta duplicata nasconde
   * esattamente il caso che si vuole vedere.
   *
   * Nessun vincolo sulle coppie ammesse: da `pro` si può andare a `free` e
   * viceversa. Le regole su chi possa cambiare piano e a quali condizioni
   * (pagamento andato a buon fine, periodo minimo, credito residuo) non sono
   * invarianti dell'utente — vivono dove vive il processo di fatturazione.
   */
  changeSubscription(subscription: UserSubscription): void {
    this.ensureNotDeleted();

    if (subscription === this.props.subscription) {
      throw new UserAlreadySubscribedError(this.props.userId, subscription);
    }

    const previous = this.props.subscription;

    this.props.subscription = subscription;
    this.apply(
      new UserSubscriptionChangedEvent(
        this.props.userId,
        previous,
        subscription,
      ),
    );
  }

  /**
   * Cancella l'utente.
   *
   * È una cancellazione *logica* a livello di aggregato, come in `Todo`: il
   * flag serve all'aggregato per rifiutare ogni transizione successiva finché
   * resta in memoria. Se il repository poi esegua una `DELETE` fisica o scriva
   * un tombstone è una decisione di persistenza, invisibile al dominio — e su
   * un utente quella decisione ha vincoli esterni al modello (cancellazione dei
   * dati personali su richiesta, conservazione dei documenti fiscali) che
   * appartengono all'adapter, non a questo metodo.
   *
   * Non è idempotente: la seconda chiamata lancia `UserDeletedError`.
   */
  delete(): void {
    this.ensureNotDeleted();

    this.props.deleted = true;
    this.apply(new UserDeletedEvent(this.props.userId));
  }

  get userId(): string {
    return this.props.userId;
  }

  /**
   * L'email è esposta perché è l'identificatore di business dell'utente: è il
   * valore su cui il layer applicativo farà il controllo di unicità che
   * l'aggregato non può fare. Nome e cognome non hanno getter — sul lato write
   * nessuno li legge, e per la persistenza c'è `snapshot()`.
   */
  get email(): Email {
    return this.props.email;
  }

  get subscription(): UserSubscription {
    return this.props.subscription;
  }

  get isDeleted(): boolean {
    return this.props.deleted;
  }

  /**
   * Un aggregato cancellato non accetta più transizioni: la sua esistenza è
   * precondizione di qualunque altra invariante, quindi va verificata prima.
   */
  private ensureNotDeleted(): void {
    if (this.props.deleted) {
      throw new UserDeletedError(this.props.userId);
    }
  }

  /** Snapshot immutabile per il repository: lo stato interno non esce mai. */
  snapshot(): Readonly<UserProps> {
    return { ...this.props };
  }
}

/**
 * Nome trimmato, o `UserNameRequiredError` se non ne resta nulla.
 *
 * Trimma i bordi e nient'altro: gli spazi interni restano. "Van der Berg" e
 * "De Luca" sono cognomi con spazi, e collassarne le sequenze significherebbe
 * decidere per l'utente come si scrive il proprio nome.
 */
function normalizeName(value: string, field: UserNameField): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new UserNameRequiredError(field);
  }

  return trimmed;
}
