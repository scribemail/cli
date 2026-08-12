/** The user must (re-)run `scribe login` — no usable credentials for this env. */
export class AuthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthRequiredError";
  }
}

/** The interactive login flow itself failed (browser, callback, exchange…). */
export class LoginFlowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoginFlowError";
  }
}
