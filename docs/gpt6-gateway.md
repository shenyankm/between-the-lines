# GPT6 gateway integration

This restores the OpenAI-compatible adapter from the former Codex commit
`5facbb3` on top of the current UI and story safeguards. It does not restore the
older story rules or overwrite the recent ending-fact validation.

The user-provided OpenAI Next Credits guide specifies
`https://api.openai-next.com/v1`. Authenticated model discovery on 2026-09-14
confirmed the exact available model ID `gpt-6-astra`. The adapter uses
`ChatOpenAI`, Responses API, low reasoning effort, bounded retries and output
tokens. DeepSeek-only `thinking` and temperature options are not sent.

Configure the ignored repository `.env` (never commit a real key):

```dotenv
AGENT_MODE=openai
OPENAI_BASE_URL=https://api.openai-next.com/v1
OPENAI_API_KEY=YOUR_KEY
OPENAI_MODEL=gpt-6-astra
OPENAI_REASONING_EFFORT=low
OPENAI_MAX_RETRIES=1
OPENAI_MAX_OUTPUT_TOKENS=1600
```

Restart the API after changing configuration. `AGENT_MODE=mock` remains available
for deterministic development and CI. The browser config contract, admission
checks, response parsing, usage model name and discussion cache identity all
follow the selected provider. Responses text blocks are extracted without
exposing reasoning or tool arguments, including JSON artifact output.

V3 dialogue now uses one read-only generation after authoritative rules resolve
grounded player actions. It reuses transport connections and streams public
final-answer text. See [NPC response behavior and latency](response-latency.md)
for the current implementation, optional model tuning, and measured limitations.

The gateway guide does not specify token prices. If prices are omitted, public
usage records return `cost_estimate_usd: null` and tokens are still counted.
Zero booked dollars in the internal ledger do not mean the gateway is free.
Set `OPENAI_INPUT_USD_PER_MILLION` and `OPENAI_OUTPUT_USD_PER_MILLION` from the
actual gateway tariff before enabling `MONTHLY_COST_CAP_USD`. Unpriced traffic
already recorded in the current month must be reconciled before a dollar cap can
admit more traffic. Production still requires the existing HTTPS, authentication
and budget safeguards.

## Verification

- Full backend regression: 351 passed, 83.38% coverage. After the final durable
  unpriced-ledger change, all 32 targeted provider and budget/edge tests passed.
- Frontend: 276 tests passed; 92.80% lines/statements, 91.53% branches and
  88.10% functions, with the API client at 100%. Ruff, mypy, TypeScript, ESLint,
  production build, asset gate, lock check and regenerated contracts passed.
  Production JavaScript remains 153,197 gzip bytes, below the approved 160 KB.

- Authenticated model discovery and a real Responses connection succeeded.
- Real browser flow: login, new story, GPT6 NPC reply, confirmed exit, generated
  ending accepted by the existing factual validator. The NPC request used one
  model call (3,816 tokens); the ending used one model call (1,353 tokens).
- A separate real graph probe called the work-inspection tool and returned a
  reply, using two model calls (5,883 tokens).
- Mock adapter/config tests cover provider-specific readiness, pricing, request
  options and exclusion of reasoning from displayed content.
- The previously observed browser initialization timeout remains an intermittent
  issue without an established cause; it was not reproduced by the live smoke.

Run the live browser check only when intentionally spending gateway credits:

```powershell
$env:BTL_LIVE_GPT6 = '1'
pnpm exec playwright test --config playwright.gpt6.config.ts
```

The regular Playwright suite still requires mock mode. Live smoke tests are
skipped by default and require an OpenAI-mode API before any game mutation.
Real-model responses vary; this smoke test is not an exhaustive assessment of
every narrative path or third-party OAuth.
