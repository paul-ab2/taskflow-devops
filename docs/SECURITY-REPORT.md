# Security report

This document records what the Security stage checks, what it found, how severe each finding is, and what was done about it. The pipeline regenerates the raw numbers on every build in `security-summary.md` (Jenkins → build → *Artifacts*). This file is the human analysis on top of them.

> **Before submitting:** copy the tables from the `security-summary.md` of your final build into section 3 and fill in the "Action" column. Do not invent CVE IDs; use the ones Trivy reports.

## 1. Threat model in brief

| Asset | Threat | Control |
|---|---|---|
| User accounts | Credential stuffing or brute force | bcrypt (cost 12 in production), login rate limit (20 per 15 min), constant-time login (dummy hash for unknown e-mails), `TaskFlowAuthFailureSpike` alert |
| Sessions (JWT) | Forged tokens, `alg:none` and key-confusion attacks | Algorithm pinned to HS256, issuer checked, 1-hour expiry, 32+ character secret enforced at startup and stored in Jenkins credentials |
| Tasks | Reading or editing another user's data (IDOR) | Ownership check in the service layer, with 403 tested for GET, PATCH and DELETE |
| API | Mass assignment or injection of unexpected fields | Joi schemas with `stripUnknown` (tested: a `role: admin` sent at registration is ignored) |
| API | Information leakage | Central error handler (no stack traces), `x-powered-by` removed, Helmet security headers including CSP |
| Supply chain | Vulnerable or compromised dependencies and tools | npm audit, Trivy, lockfile + `npm ci`, SBOM, pinned tool versions (see 2.3) |
| Runtime | Container breakout or privilege escalation | Non-root user, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, resource limits |
| Secrets | Secrets committed to Git | Trivy secret scanning (fails the build), secrets only in Jenkins credentials and the git-ignored `infra/.env` |

## 2. Findings handled proactively, before the scanners ran

### 2.1 Runtime image: package managers removed (expected HIGH findings)

* **Issue:** the official `node:22-alpine` image bundles npm, corepack and yarn. Their own dependencies (for example `cross-spawn`, `glob` and `tar` inside npm) regularly appear in Trivy image scans with HIGH CVEs.
* **Severity:** HIGH as reported. The real risk is low, because the app never runs npm at runtime.
* **Action: fixed.** The Dockerfile deletes npm, npx, corepack and yarn from the runtime layer and runs `apk upgrade` to pick up patched Alpine packages. Dependencies are installed in a separate build stage with `npm ci --omit=dev`, so dev tools (Jest, ESLint and so on) never reach the image.

### 2.2 Application-level vulnerabilities designed out, and proven by tests

| Issue | Severity (CVSS-style) | Fix | Test |
|---|---|---|---|
| JWT `alg:none` / algorithm confusion | Critical | `algorithms: ['HS256']` on verify | `auth.service.test.js`: "rejects unsigned alg:none tokens" |
| Weak default JWT secret in production | High | App refuses to start in staging/production without a 32+ character secret | `config.test.js` |
| User enumeration through login responses or timing | Medium | Identical message plus a bcrypt compare against a dummy hash | `auth.service.test.js` |
| IDOR on `/api/tasks/:id` | High | Ownership check | `tasks.api.test.js`: 403 cases |
| Privilege escalation via mass assignment | High | Joi `stripUnknown` | `auth.api.test.js` |
| Brute-force login | Medium | `express-rate-limit` | `auth.api.test.js`: 429 case |
| Timing attack on the chaos admin token | Low | `crypto.timingSafeEqual` | `middleware.test.js` |
| Chaos endpoint usable in production | Medium | Disabled (404) unless `CHAOS_TOKEN` is set; token comes from Jenkins credentials; experiments auto-expire | `platform.api.test.js` |

### 2.3 Supply-chain incident: Trivy itself (CVE-2026-33634)

* **Issue:** in March 2026, Trivy releases **v0.69.4** (and v0.69.5/v0.69.6 on Docker Hub) were published with malicious code that stole CI secrets. The `trivy-action` GitHub Action tags were also hijacked.
* **Severity:** Critical (actively exploited).
* **Action: mitigated.** The Jenkins image pins `aquasec/trivy:0.69.3`, which the advisory lists as a safe release. It does not use `latest`. This is the reason all tool versions in `infra/` are pinned.

### 2.4 CI infrastructure trade-off (accepted risk)

* **Issue:** the Jenkins container runs as root with the host Docker socket mounted. A malicious pipeline could therefore control the Docker host.
* **Severity:** High in a shared environment, Low for this single-user lab.
* **Action: accepted and documented.** The Jenkins *image* still ends with `USER jenkins`; only the local `docker-compose.yml` overrides it, with a comment. Jenkins is reachable only on localhost, sign-up is disabled and every user must log in. A production setup would use ephemeral agents and rootless builds (see docs/PIPELINE.md).

## 3. Scanner results (latest pipeline run)

Results as of the date this was written. Update this section from your final build.

| Scanner | CRITICAL | HIGH | MEDIUM | LOW | Notes |
|---|---|---|---|---|---|
| npm audit (production deps) | 0 | 0 | 0 | 0 | Clean on 1 Oct 2026; the full dev-dependency tree is also clean |
| Trivy fs (lockfile) | _from build_ | | | | |
| Trivy fs (secrets) | _from build_ | | | | Expected 0 |
| Trivy fs (Dockerfile misconfig) | _from build_ | | | | Both Dockerfiles have USER and HEALTHCHECK |
| Trivy image | _from build_ | | | | Typically a few Alpine OS CVEs, some with no fix yet |

### Findings and actions

Use one row per CRITICAL, HIGH or MEDIUM finding in `security-summary.md`:

| ID | Package | Severity | What it is | Action |
|---|---|---|---|---|
| _e.g. CVE-XXXX-YYYY_ | _busybox_ | _MEDIUM_ | _short description from Trivy's title_ | _No fix released upstream. Not reachable: the app never invokes busybox. Re-checked every build; accepted with expiry in `.trivyignore.yaml`_ |
| | | | | _or: Fixed by bumping the base image / `npm update <pkg>`; rebuilt; finding gone in build #N_ |

### How to triage a new finding

1. **Fix available?** Bump it: `npm update <pkg>`, or rebuild to pick up the patched base image (the Dockerfile runs `apk upgrade`). Then re-run the pipeline and confirm the finding is gone.
2. **No fix, but reachable?** Mitigate in code or config (for example disable the feature or add input validation) and record it here.
3. **No fix and not reachable?** Add it to `.trivyignore.yaml` with a `statement` and an `expired_at` date, and record it here.
