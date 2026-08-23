# Authentication abuse controls

The API applies in-process throttling to human login and to agent credential/management endpoints. Login has independent per-IP and per-account limits; failed attempts use bounded exponential backoff and successful login resets both counters. Token issue, reveal, revoke, agent creation/deletion, webhook configuration, and secret rotation use a stricter request limit.

Defaults are intentionally usable for local development and can be changed with `LOGIN_RATE_LIMIT_IP`, `LOGIN_RATE_LIMIT_ACCOUNT`, `SENSITIVE_RATE_LIMIT`, `RATE_LIMIT_WINDOW_MS`, and `RATE_LIMIT_MAX_BACKOFF_MS`. In a multi-worker deployment, keep a shared edge limiter in front of the API as the in-process limiter is per worker.

Fastify uses the socket peer address unless `TRUST_PROXY` is explicitly configured. Set it to `true` only when every hop is a trusted proxy, or provide a comma-separated list of trusted proxy addresses. Do not enable it on a directly exposed API: otherwise a client could spoof `X-Forwarded-For`.

Successful, failed, and throttled sensitive actions are written to `security_audit_events` with action, outcome, source IP, account identifier, and user ID. Passwords, API tokens, webhook secrets, and request bodies are never stored or logged.
