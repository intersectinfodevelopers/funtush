# Response to the QA reports — 6 to 8 October 2026

Covers the daily reports from **Runiva Sakhya** (6 Oct) and **Shubham Khadka** (Day 1 — 6 Oct, Day 2 — 8 Oct), all against
`https://develop.shirijanga.com`. Every item below was traced to code; the fixes are in the same change, with tests.

## 1. Bugs

| Bug | Sev | Root cause | Fix | Retest |
|---|---|---|---|---|
| **BUG-002** OpenAPI `servers` points at `http://localhost:4000` | S4 | `docs.json` only listed `/` and localhost. Tools that import it (Postman) cannot use a relative `/`, so they fell back to localhost. | The environment's own origin (`API_PUBLIC_URL`) is now listed **first**. Needs `API_PUBLIC_URL=https://develop.shirijanga.com` in the server `.env`. | `GET /docs.json` → `servers[0].url` is `https://develop.shirijanga.com`; re-import into Postman. |
| **BUG-201** `POST /upload` → 500 (`getaddrinfo ENOTFOUND`) | S2 | In production mode uploads always go to the S3-compatible bucket in `STORAGE_ENDPOINT`, and a host name in that path does not resolve — most likely a placeholder/typo, or a custom domain that needs path-style URLs. It is a **server configuration problem**, not an API logic bug (the exact value on the server has not been inspected). | An unreachable store now returns **503 "File storage is temporarily unavailable"** (no host leaked) instead of an opaque 500. Two ways to make uploads work on staging: set a real `STORAGE_ENDPOINT` (+ `STORAGE_FORCE_PATH_STYLE=true` for a custom/MinIO endpoint), **or** `STORAGE_DRIVER=local` with `CDN_BASE_URL=https://develop.shirijanga.com/cdn` and a mounted `LOCAL_UPLOAD_DIR`. | Upload a small PNG → 200 + url; with storage down → 503. |
| **BUG-202** lowercase `difficulty` rejected | S3 | The validator compared against UPPERCASE values but built its error message with `.toLowerCase()`, so it told callers to send lowercase and then rejected it. | `difficulty` is accepted in **any letter case** and stored as the canonical enum value. `PATCH /agencies/packages/:id` now validates it too (it used to reach the database unchecked). | `POST /agencies/packages` with `"difficulty": "moderate"` → 201 and stored as `MODERATE`. |
| **BUG-203** `POST /marketplace/click` wrong-type body → 500 | S3 | The handler trusted `req.body`; a number/boolean/array went straight to the database layer and threw. | Every field is type- and length-checked → **400** with a specific message (`agencyId must be a string`, …). A well-formed id that matches no agency → **404**, not 500. | Repeat EP-196-02: agencyId `123`, destination `true`, searchQuery `["x"]` → 400 each. |
| **BUG-204** repeated identical clicks all counted (17 → 69) | S3 | No deduplication; the route's only protection is the shared 200 requests/minute/route limit, which 52 requests never reach. | The same visitor clicking the same agency + destination + query within **30 s** is counted once (the repeat returns `200 { deduplicated: true }`). "Same visitor" = signed-in trekker, else `x-visitor-id`, else IP + user-agent. Fails open if Redis is down. | Send 52 identical clicks → `totalClicks` rises by 1. A **different** destination/agency/visitor still counts. |
| *Known issue* `PATCH /admin/agencies/{id}/tier` unknown tier → 500 | S3 | The route turned every error into a 500. | Unknown tier → **400** `Unknown tier: X`; unknown agency id → **404** (same for `/status`). | `{"tier":"GOLD"}` → 400. |
| *Known issue* `POST /auth/trekker/resend-otp` → 500 | ? | **Not reproducible from the code**: rate limits already return 429, bad input returns the generic 200. The 500 is an internal failure whose cause is only in the server log. | None yet. | Please send the log line: `docker logs --since 24h funtush-api 2>&1 \| grep -A8 "\[resend-otp\]"` plus the exact request. |

## 2. The marketplace blocker (EP-191-03/04/05, EP-193-01/03, EP-197-01/03)

This was **not a bug** — three visibility rules combined, and the QA agency broke all of them:

1. **Tier/status.** The marketplace only shows agencies that are `ACTIVE` and on a **paid tier**. `agency@funtush.com` is a
   FREE-tier / TRIAL agency, so a package published under it is hidden on purpose — `/marketplace/packages/{slug}` → 404.
2. **Search index.** `GET /marketplace/packages` is served from **Meilisearch**, not the database. Rows inserted by a seed
   script are not indexed until `pnpm --filter @funtush/api search:reindex` runs.
3. **KYC.** `GET /marketplace/agencies` and ranking additionally require KYC **APPROVED**.

Why `/marketplace/stats` said "3 packages, 1 agency" while the list returned 0: stats deliberately count **every registered**
agency and published package (documented in `marketplaceCuration.service.ts`), while the list applies the rules above.

**Data fix:** `pnpm --filter @funtush/api seed:marketplace-demo` creates two verified agencies (MEDIUM and LARGE), six
published packages across all four difficulties, itineraries, future departures and reviews, then reindexes search. Two agencies
unblock the *compare* cases (EP-197-01/03). Commands and the full list are in `docs/QA_TEST_ACCOUNTS.md`.

## 3. Questions in the reports

- **Runiva — is `permissions: []` on `/auth/me` expected for AGENCY_ADMIN and SUPER_ADMIN?** Yes. `/auth/me` returns
  `permissions` from the login token, and no login puts permissions in the token, so it is `[]` for **everyone** (including staff
  with a custom role). It means "not populated", **not** "no access": platform admins (SUPER_ADMIN / PLATFORM_ADMIN) pass every
  permission check by role (`requirePlatformPermission`), and nothing reads permissions from this field. Don't assert on it; use
  `GET /admin/me` (platform staff) or the staff/roles endpoints under `/agencies/me/*`.
- **Runiva — sandbox payment/webhook secrets.** These have not been handed over, so the Billing and Webhooks cases stay blocked until
  the owner puts Stripe/Khalti/eSewa/ConnectIPS test keys in the server `.env` and gives QA the matching webhook signing secrets.
- **Shubham — first request after idle is slow (820–890 ms).** Most likely not a server cold start. The first request of a Postman
  run opens a new connection through Cloudflare from Nepal (DNS + TCP + TLS ≈ 3–4 round trips of ~200 ms); later requests reuse it
  (~200–280 ms), which matches what was observed.
  Measure the server separately with `curl -s -o /dev/null -w "connect %{time_connect}s tls %{time_appconnect}s ttfb %{time_starttransfer}s\n" <url>`:
  the API's own time is `ttfb − tls`. Apply the 500 ms read target to that.

## 4. Corrections to the reports

- **Day 1, "0 agencies and 0 packages"** → should read "0 agencies/packages *visible in the marketplace*". The database had rows;
  they were filtered out (section 2).
- **Day 2, latency note.** "Below the 1000 ms write target but above the 500 ms read target" mixes two targets. The slow first
  requests were reads (EP-192/194/195, target 500 ms) and one write (EP-196, target 1000 ms). Per section 3, this is connection setup.
- **BUG-201 title** — "S3/DNS" is misleading; it is a *storage endpoint configuration* error (section 1). Severity stays S2 until uploads work.
- **BUG-204** — add the reproduction detail that no 429 appears because the per-route limit is 200 requests/minute; the click now has its own dedupe.
- **Test-case denominators.** Runiva's scope is 796 cases and Shubham's is 764, so the two "x / N" progress figures are
  separate scopes and should not be added together. Day 2's own arithmetic checks out (7 + 13 = 20; 20 / 764 = 2.6 %; 9 + 2 + 2 = 13).

## 5. What needs a deploy / server setting

1. Deploy this change to `develop`.
2. Server `.env`: `API_PUBLIC_URL=https://develop.shirijanga.com`, and **one** of the two storage setups from `.env.example`.
3. Run the marketplace seed (section 2), then QA retests the table in section 1.
