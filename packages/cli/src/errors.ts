/** The user cancelled (answered no, or input ended). Exit code 2. */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

/** A failure with a Persian message that is shown as is. Exit code 1. */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
