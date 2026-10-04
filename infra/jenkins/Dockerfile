# ---------------------------------------------------------------------------
# Custom Jenkins controller image - "Jenkins as code"
#  * plugins pinned in plugins.txt and installed at build time
#  * whole system configuration (users, credentials, SonarQube server,
#    mail server, the pipeline job itself) applied from casc.yaml by the
#    Configuration-as-Code plugin -> no manual clicking in the UI
#  * CI tool-chain baked in: Node.js 22, Docker CLI + Compose, Trivy, jq
# ---------------------------------------------------------------------------
FROM docker:28-cli AS docker-cli
# Trivy is pinned to 0.69.3 on purpose: 0.69.4-0.69.6 were the releases
# compromised in the March 2026 supply-chain attack (CVE-2026-33634).
FROM aquasec/trivy:0.69.3 AS trivy
FROM node:22-bookworm-slim AS node

FROM jenkins/jenkins:lts-jdk21

USER root
RUN apt-get update \
 && apt-get install -y --no-install-recommends jq zip libstdc++6 \
 && rm -rf /var/lib/apt/lists/*

# Docker CLI with compose + buildx plugins (talks to the host daemon via the mounted socket)
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

# Trivy scanner + its report templates
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=trivy /contrib /opt/trivy/contrib

# Node.js 22 LTS + npm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && node --version && npm --version && docker --version && trivy --version

# Plugins + configuration as code
COPY plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli --plugin-file /usr/share/jenkins/ref/plugins.txt
COPY casc.yaml /var/jenkins_casc/casc.yaml

ENV CASC_JENKINS_CONFIG=/var/jenkins_casc/casc.yaml \
    JAVA_OPTS="-Djenkins.install.runSetupWizard=false"

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD curl -fs http://localhost:8080/login > /dev/null || exit 1

# Image default is the unprivileged jenkins user. docker-compose.yml overrides
# this to root ONLY for the local lab so the controller can use the Docker socket
# (documented trade-off - see docs/SECURITY-REPORT.md).
USER jenkins
