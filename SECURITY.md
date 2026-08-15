# Security review — dsh-token-anxiety

Reviewed: 2026-08-15. The bundle is an out-of-tree DeepSeek Harness plugin composed
through the web profile. It adds three HTTP routes on the harness webserver and a
browser half that renders session-derived cost data. No custom session events are
written, so session logs stay loadable and no log-format risk is introduced.

## Trust model

The bundle runs inside the harness process and trusts the deployment's existing
loopback posture. The three routes sit **outside** the harness `/api` prefix, so
they apply the same browser-trust predicate themselves (`isTrustedExplainRequest`):
a loopback or `trustedHosts` Host header, no `sec-fetch-site: cross-site` marker,
and a same-origin `Origin` when one is attached. This closes the two confused-
deputy paths the `/api` fence defends against: DNS rebinding (Host check) and
cross-site CSRF from malicious pages (Origin + `sec-fetch-site`).

| Attack vector | Status |
|---|---|
| DNS rebinding (attacker domain → 127.0.0.1) | Blocked — Host must be loopback or `trustedHosts` |
| Cross-site POST from a malicious page | Blocked — `sec-fetch-site` + same-origin `Origin` |
| Reading responses cross-origin | Blocked — no CORS headers |
| Local-process abuse (same machine) | In scope by design — same trust boundary as the harness itself |
| Session data of other sessions | A fenced caller may pass any `sessionId` to `/token-anxiety/explain`; this is equivalent to the harness's own loopback read access |

## Routes

### `POST /token-anxiety/explain`
- Fence (above), POST-only, 405 otherwise.
- Body capped at 8 KB (413), parsed as JSON; `task` must be a positive integer;
  `sessionId` is used only as a lookup key. No path traversal, no file access.
- The analysis runs one LLM call; a light anti-abuse guard throttles starts
  (≥2 s apart) and caps concurrent runs (2) with 429. The LLM request is built
  server-side from session logs; the response contains only generated text.
- Language detection operates on logged user text and is a heuristic only.

### `POST /token-anxiety/pricing-sync`
- Same fence and POST-only. Fetches two fixed HTTPS URLs (DeepSeek pricing page,
  `open.er-api.com` FX). Both are constant — no user-controlled destination, so
  no SSRF surface.
- The official page is turned into text and sent to an LLM with a strict JSON
  schema; the model output is JSON-parsed and every number validated before the
  override is written. FX rates are cached for 24 h; fetch failure falls back to
  existing rates (never fails the sync).
- Writes `pricing.override.json` next to the bundle (a fixed path, atomically via
  `writeFileSync` after full validation).

### `POST /token-anxiety/currencies`
- Same fence, POST-only, body capped at 8 KB. The list is validated: 1–40 codes,
  each exactly `[A-Z]{3}`, unique. Writes only `currencies` into the override.

## Client side

- All data renders through React text nodes; no `dangerouslySetInnerHTML`, no
  injection surface. The pricing JSON view was removed.
- The bundle writes no custom session events (`session.append` was removed), so
  sessions using the chip remain loadable by any harness build.
- The currency/theme logic is pure client state; nothing sensitive is stored.

## Data handling

- The override file (`pricing.override.json`) is machine-local runtime state:
  prices, FX rates, enabled-currency list. It contains no credentials.
- Session logs are read host-side only, through the harness's own services
  (`sessions`, `sessionQuery`); nothing is exported over the wire beyond the
  analysis text the LLM produced.

## Recommendations / residual risks

- **No authentication.** The fence is reachability, not auth — same as the
  harness's `/api` posture. Keep the webserver bound to loopback (`127.0.0.1`);
  never bind `0.0.0.0` without a real authentication layer.
- **In-memory anti-abuse only.** The explain rate limit resets on process
  restart and is per-process; adequate for a local tool, not for multi-tenant
  exposure.
- **LLM output trust.** The pricing sync accepts the model's parsed JSON; the
  validator is the guardrail (numbers, shape). A confused model yields a failed
  sync (502), never arbitrary writes.
- **Dependency surface.** The bundle has zero runtime dependencies (node builtins
  only) — no supply-chain exposure from third-party packages.
- **FX fallback rates** in the client mirror the embedded defaults and are
  replaced by synced rates once the host restarts with them.
