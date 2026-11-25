/** Inference finished, but its archive outcome must be reconciled before more inference. */
export class BriefingArchiveUnconfirmedError extends Error {
  constructor(message: string) { super(message); this.name = "BriefingArchiveUnconfirmedError"; }
}
