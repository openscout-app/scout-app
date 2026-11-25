# Account status adapters

These small, read-only adapters report configuration, plan membership, balances,
usage and reset times. They do not own inference, session launch, model selection,
login, token refresh, or account changes. A credential or CLI login proves only
configuration; a balance requires its own reading.

`model-provider-accounts.ts` discovers credentials and supplies a bounded JSON
reader. Tokens stay inside the server and are sent only to the adapter's fixed
first-party account endpoint. The output type contains no credentials. The
service-budgets aggregator caches these readings separately from inference.

- OpenRouter: account credits, distinct from a per-key spending cap. Negative
  balances remain visible.
- Hugging Face: account/PRO verification. Remaining compute credits require the
  dashboard; membership does not establish an allowance.
- OpenCode Console and Go: separate configured accounts. No balance is inferred
  from possession of a key or a model catalog.
- Cursor: local membership or CLI sign-in. A saved dashboard import is a usage
  snapshot; it does not establish current remaining credits.
- EXE: VM configuration and Shelley model allocation are different balances.

Subscription collectors remain in `service-budgets.ts`. New provider-specific
account reads belong here. Do not import inference SDKs into these adapters.
`GET /api/service-budgets` reads status and previously cached advice only.
`POST /api/service-budgets/advice` is an explicit, separate inference action.
