# Pipeline design: stage by stage

The pipeline is declared in the `Jenkinsfile`. The Jenkins server that runs it is declared in `infra/`, so a reviewer can rebuild the whole system from Git with one command.

## Design principles

1. **Build once, promote many.** One Docker image is built in stage 1, and that exact image is tested, scanned, deployed to staging and promoted to production. Nothing is rebuilt between environments, so what was tested is what ships.
2. **Every stage is a gate.** Stages fail or mark the build *unstable* according to explicit, documented thresholds. A failure stops promotion and e-mails the team.
3. **Traceability.** Version `1.0.0-build.N` is stamped into `build-info.json`, the image labels, the image tag, the SonarQube analysis, the git release tag and the Grafana annotation. It is also visible in the UI and at `/api/version`.
4. **Everything as code.** This covers the pipeline (Jenkinsfile), Jenkins (casc.yaml + plugins.txt), environments (deploy/docker-compose.yml), the quality gate (scripts/sonar-setup.sh), alert rules, Alertmanager routes and Grafana dashboards.

## Stage details

### 1. Build

* `npm ci` gives a reproducible install from the lockfile.
* `npm run build` writes `build-info.json` (version, commit, build number, timestamp).
* **Artefacts:**
  * `taskflow-api-<ver>.tgz` from `npm pack`, archived and fingerprinted in Jenkins.
  * Docker image `localhost:5001/taskflow-api:<ver>-build.<n>` plus `:sha-<commit>`, pushed to the private registry. The image carries OCI labels for version, revision, creation date and source.
* **Image hardening:** multi-stage build, non-root `node` user, `apk upgrade`, npm/yarn/corepack removed from the runtime layer, and a `HEALTHCHECK`.

### 2. Test

| Layer | Tooling | What it proves |
|---|---|---|
| Unit (5 suites) | Jest with fakes | Business rules (status transitions, overdue logic, stats), auth (hashing, JWT pinning, `alg:none` rejection), config validation, middleware, chaos controller |
| Integration (3 suites) | Jest + Supertest against the real Express app | Full HTTP behaviour: CRUD, validation errors, 401/403/404/409/429, tenant isolation, security headers, metrics output |
| Smoke / acceptance | Jest over `fetch` against the **deployed** container | Runs in the Deploy and Release stages. Covers health, the expected version and environment, the register → login → task lifecycle, and the metrics endpoint |

**Gate:** any failing test, or coverage below the `jest.config.js` thresholds (statements 85%, branches 75%, functions 85%, lines 85%). Current coverage is about 99% of statements and 92% of branches.

**Feedback in Jenkins:** JUnit trend chart, Coverage plugin (with per-build history), and an HTML coverage report.

### 3. Code Quality

Two layers.

**ESLint** (`eslint.config.js`) gives fast feedback on structure:

* `complexity` ≤ 10, `max-depth` ≤ 3, `max-params` ≤ 4, `max-nested-callbacks` ≤ 4, `max-lines-per-function` 60 (warning), plus `eqeqeq`, `no-eval` and similar rules.
* The stage fails on any error or on more than 10 warnings. The Warnings NG plugin charts the trend in Jenkins.
* These rules caught real problems during development. `buildConfig()` had a complexity of 18 and `createMetrics()` had 88 lines, and both were refactored into smaller functions before the first commit.

**SonarQube** handles maintainability analysis, duplication and coverage import. ESLint results are imported as external issues. `scripts/sonar-setup.sh` creates a custom gate, **"TaskFlow Gate"**:

| Condition | Threshold | Why |
|---|---|---|
| Coverage (overall and new code) | ≥ 80% | Untested code is where regressions hide |
| Duplicated lines (overall and new) | ≤ 3% | Copy-paste means every bug has to be fixed several times |
| Maintainability rating (overall and new) | A | Technical-debt ratio below 5% |
| Reliability rating (overall and new) | A | Zero bugs |
| Security rating (overall and new) | A | Zero vulnerabilities in code (deep scanning happens in the Security stage) |

**Configuration choices:**

* **Exclusions:** tests are excluded from duplication checks (arrange/act/assert is intentionally repetitive). `public/` and `server.js` are excluded from coverage because the browser client and process bootstrap are covered by smoke tests.
* **Gated check:** `sonar.qualitygate.wait=true` makes the stage fail when the gate fails.
* **Trend:** every build is analysed with `sonar.projectVersion=<app version>`, and the new-code period is "previous version". The SonarQube *Activity* page therefore shows a history point per build, and the new-code conditions catch regressions build by build.
* `scripts/sonar-report.sh` prints the metrics into the Jenkins log with a plain-English explanation of each.

### 4. Security

| Scanner | Scope |
|---|---|
| `npm audit --omit=dev` | Known CVEs in production dependencies |
| `trivy fs` | Lockfile vulnerabilities, **hard-coded secrets**, **Dockerfile misconfigurations** (IaC) |
| `trivy image` | OS packages and `node_modules` inside the image that actually ships |
| `trivy image --format cyclonedx` | SBOM, a software bill of materials archived with the build |

`scripts/security-summary.sh` merges all scanner output into `security-summary.md`, which is categorised by severity with package, installed version and fixed version. It then applies the policy:

| Finding | Action |
|---|---|
| CRITICAL with a fix available | **Fail** |
| Any leaked secret | **Fail** |
| HIGH or CRITICAL Dockerfile misconfiguration | **Fail** |
| HIGH with a fix available | **Unstable**: the build continues but is flagged for review |
| MEDIUM / LOW, or no fix available | Reported and tracked in docs/SECURITY-REPORT.md |

Accepted risks must go into `.trivyignore.yaml` with a written justification and an expiry date. See `docs/SECURITY-REPORT.md` for the findings and how they were handled.

### 5. Deploy (staging)

* `deploy/deploy.sh staging <image> <version>` runs `docker compose up --wait`. The step only succeeds once the container's HEALTHCHECK reports healthy and `/api/version` returns the version that was just deployed.
* **Automatic rollback:** if the container is unhealthy or reports the wrong version, the previous image is redeployed. If the smoke tests fail, the pipeline calls `deploy/rollback.sh`.
* **Infrastructure as code:** one parameterised `deploy/docker-compose.yml` serves both environments. The runtime is hardened: read-only filesystem, all Linux capabilities dropped, `no-new-privileges`, CPU/memory limits and log rotation.
* Secrets (JWT secret, chaos token) are injected from Jenkins credentials and never stored in Git.
* Every deployment is appended to an audit log at `/var/jenkins_home/deployments/<env>.history`.

### 6. Release (production)

* Optional manual approval (`REQUIRE_APPROVAL`). It is off by default, so the pipeline is fully automated.
* **Promotion:** the already-tested image is re-tagged `1.0.0`, `stable` and `production` and pushed to the registry. It is not rebuilt.
* `RELEASE_NOTES.md` is generated from the git log since the previous release tag.
* Production is deployed with the same health-gated, auto-rollback script. **Environment-specific config** comes from `deploy/env/production.env`: info-level logs, 1-hour tokens, bcrypt cost 12 and a strict login rate limit. Staging uses debug logs and relaxed limits.
* Production smoke tests run against the live container. If they fail, production rolls back automatically.
* An annotated git tag `v1.0.0-build.N` is pushed to GitHub, so the repository shows exactly which commit is in production.

### 7. Monitoring & Alerting

**What gets collected:**

* **Metrics:** the app exposes RED metrics (`http_requests_total`, `http_request_duration_seconds` by route), business metrics (sign-ups, tasks created and completed, failed logins) and Node.js runtime metrics. Prometheus also probes `/health` from outside with the blackbox exporter and scrapes Jenkins itself.
* **Alert rules:** 11 rules, each with a severity, a description of the live value and a runbook hint. They cover production down, failing health probe, error rate above 5%, p95 latency above 500 ms, event-loop lag, memory, CPU, a failed-login spike (possible brute force), an active chaos experiment and a failing pipeline.
* **Routing:** Alertmanager sends critical alerts to on-call plus the team, and everything else to the team inbox. Delivery is by e-mail to Mailpit, including RESOLVED notifications. An inhibition rule suppresses warnings while production is completely down.
* **Dashboard:** Grafana has a provisioned dashboard with status, version, request rate, error %, latency percentiles, resources, business and security panels, the firing-alerts list, Jenkins build health, and deployment/incident annotations.

**What the stage does:**

1. Reloads Prometheus so rule changes go live.
2. Waits until Prometheus sees the **new version** in production.
3. Checks that the rules are loaded and Alertmanager is ready.
4. Sends warm-up traffic.
5. Posts a "Release vX deployed" annotation to Grafana.
6. Marks the build unstable if any critical production alert is firing.

**Incident simulation:** `SIMULATE_INCIDENT` runs `scripts/simulate-incident.sh`. It injects 60% errors, adds 1.2 s of latency, or stops the production container. It then waits for the matching alert, confirms the e-mail reached the team inbox, removes the fault, and reports the time to detect.

## Known limitations and trade-offs

* **Jenkins runs as root and has access to the host Docker socket.** This is acceptable for a single-user lab but would not be in production. A real team would use ephemeral build agents, rootless BuildKit or Kaniko, and remote deploy targets.
* **Storage is in memory**, behind repository interfaces. Data resets on redeploy. Adding PostgreSQL means writing a new repository class; the services and routes would not change.
* **Polling instead of webhooks**, because GitHub cannot reach a laptop. A tunnel (for example ngrok) or a cloud-hosted Jenkins would allow push-based triggers.
* **Single host.** Staging and production share a Docker host. In a real setup they would be separate hosts or clusters, and blue/green or canary releases would replace stop-and-start recreation.
