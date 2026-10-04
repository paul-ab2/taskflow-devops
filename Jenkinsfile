// ===========================================================================
// TaskFlow API - CI/CD pipeline (SIT753 Task 7.3HD)
//
//   Build -> Test -> Code Quality -> Security -> Deploy (staging)
//         -> Release (production) -> Monitoring & Alerting
//
// Every stage is a quality gate: a failure stops promotion, so only an image
// that passed ALL checks can reach production. The same immutable Docker image
// (tagged with the version + build number + commit) flows through every stage.
// ===========================================================================
pipeline {
  agent any

  parameters {
    booleanParam(name: 'REQUIRE_APPROVAL', defaultValue: false,
      description: 'Pause for a manual "Promote to production?" approval before the Release stage')
    choice(name: 'SIMULATE_INCIDENT', choices: ['none', 'error-spike', 'latency', 'outage'],
      description: 'Run an incident simulation in the Monitoring stage and verify that the alert fires and the team is e-mailed')
  }

  triggers {
    // GitHub webhooks cannot reach a laptop, so Jenkins polls Git for new commits.
    pollSCM('H/2 * * * *')
  }

  options {
    timestamps()
    ansiColor('xterm')
    disableConcurrentBuilds()
    timeout(time: 45, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30', artifactNumToKeepStr: '10'))
  }

  environment {
    IMAGE_NAME       = 'taskflow-api'
    SONAR_PROJECT    = 'taskflow-api'
    PROMETHEUS_URL   = 'http://prometheus:9090'
    ALERTMANAGER_URL = 'http://alertmanager:9093'
    GRAFANA_URL      = 'http://grafana:3000'
    MAILPIT_URL      = 'http://mailpit:8025'
    TRIVY_CACHE_DIR  = '/var/jenkins_home/.cache/trivy'
    npm_config_cache = '/var/jenkins_home/.npm'
    CI               = 'true'
    FORCE_COLOR      = '1'
  }

  stages {

    // -----------------------------------------------------------------------
    // 1. BUILD - install, stamp version metadata, create versioned artefacts
    // -----------------------------------------------------------------------
    stage('Build') {
      steps {
        script {
          def pkg = readJSON file: 'package.json'
          env.GIT_SHORT   = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          env.APP_VERSION = "${pkg.version}-build.${env.BUILD_NUMBER}"
          env.BASE_VERSION = pkg.version
          env.IMAGE_REF   = "${env.REGISTRY}/${env.IMAGE_NAME}:${env.APP_VERSION}"
          env.IMAGE_SHA   = "${env.REGISTRY}/${env.IMAGE_NAME}:sha-${env.GIT_SHORT}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} v${env.APP_VERSION}"
          currentBuild.description = "commit ${env.GIT_SHORT}"
        }
        sh '''
          set -e
          echo "Building ${IMAGE_NAME} ${APP_VERSION} (commit ${GIT_SHORT})"
          node --version && npm --version && docker --version
          mkdir -p reports dist
          npm ci --no-audit --no-fund
          APP_VERSION="$APP_VERSION" GIT_COMMIT="$GIT_COMMIT" npm run build

          # Artefact 1: npm package of the application
          npm pack --pack-destination dist
          # Artefact 2: Docker image, tagged with version and commit, labelled with build metadata
          docker build \
            --build-arg APP_VERSION="$APP_VERSION" \
            --build-arg GIT_COMMIT="$GIT_SHORT" \
            --build-arg BUILD_NUMBER="$BUILD_NUMBER" \
            --build-arg BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            --build-arg SOURCE_URL="$GIT_URL" \
            -t "$IMAGE_REF" -t "$IMAGE_SHA" .
          # Artefact storage: push immutable tags to the private registry
          docker push "$IMAGE_REF"
          docker push "$IMAGE_SHA"
          docker image inspect "$IMAGE_REF" --format 'image size: {{.Size}} bytes, id: {{.Id}}'

          cat > dist/build-metadata.json <<EOF
{"version":"$APP_VERSION","commit":"$GIT_COMMIT","build":"$BUILD_NUMBER","image":"$IMAGE_REF","buildUrl":"$BUILD_URL"}
EOF
        '''
      }
      post {
        success {
          archiveArtifacts artifacts: 'dist/*.tgz, dist/build-metadata.json, build-info.json', fingerprint: true
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. TEST - unit + integration tests (Jest/Supertest) with coverage gate
    // -----------------------------------------------------------------------
    stage('Test') {
      steps {
        // jest.config.js enforces coverage thresholds -> the stage fails if they are not met
        sh 'npm run test:ci'
      }
      post {
        always {
          junit testResults: 'reports/junit/jest-results.xml', allowEmptyResults: false
          recordCoverage(tools: [[parser: 'COBERTURA', pattern: 'coverage/cobertura-coverage.xml']],
                         id: 'coverage', name: 'Jest Coverage', sourceCodeRetention: 'EVERY_BUILD')
          publishHTML(target: [reportName: 'Coverage Report', reportDir: 'coverage/lcov-report',
                               reportFiles: 'index.html', keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
        }
      }
    }

    // -----------------------------------------------------------------------
    // 3. CODE QUALITY - ESLint (style/complexity rules) + SonarQube quality gate
    // -----------------------------------------------------------------------
    stage('Code Quality') {
      steps {
        // ESLint: fails on any error (complexity > 10, depth > 3 ...) or more than 10 warnings
        sh 'npm run lint:ci'
        withSonarQubeEnv('SonarQube') {
          // sonar.qualitygate.wait=true makes the scanner fail this stage if the "TaskFlow Gate" fails
          sh '''
            npx sonar-scanner-npm \
              -Dsonar.host.url="$SONAR_HOST_URL" \
              -Dsonar.token="$SONAR_AUTH_TOKEN" \
              -Dsonar.projectVersion="$APP_VERSION" \
              -Dsonar.scm.revision="$GIT_COMMIT" \
              -Dsonar.scanner.javaOpts=-Xmx512m
          '''
          sh 'bash scripts/sonar-report.sh "$SONAR_PROJECT"'
        }
      }
      post {
        always {
          recordIssues(tools: [esLint(pattern: 'reports/eslint-checkstyle.xml')], id: 'eslint', name: 'ESLint')
          archiveArtifacts artifacts: 'reports/eslint*.json, reports/sonar-*.json', allowEmptyArchive: true
        }
      }
    }

    // -----------------------------------------------------------------------
    // 4. SECURITY - dependency (SCA), secret, IaC and container image scanning
    // -----------------------------------------------------------------------
    stage('Security') {
      steps {
        // Scanners run sequentially because Trivy locks its vulnerability-DB cache.
        sh '''
          set -e
          echo "== SCA: npm audit (production dependencies) =="
          npm audit --omit=dev --json > reports/npm-audit.json || true
          npm audit --omit=dev || true

          echo "== Trivy fs: lockfile vulnerabilities, hard-coded secrets, Dockerfile misconfigurations =="
          trivy fs --cache-dir "$TRIVY_CACHE_DIR" --quiet \
            --scanners vuln,secret,misconfig \
            --ignorefile .trivyignore.yaml \
            --skip-dirs node_modules --skip-dirs coverage --skip-dirs reports --skip-dirs dist \
            --format json --output reports/trivy-fs.json .
          trivy convert --format table reports/trivy-fs.json

          echo "== Trivy image: OS packages + runtime node_modules inside $IMAGE_REF =="
          trivy image --cache-dir "$TRIVY_CACHE_DIR" --quiet \
            --scanners vuln,secret \
            --ignorefile .trivyignore.yaml \
            --format json --output reports/trivy-image.json "$IMAGE_REF"
          trivy convert --format table --severity CRITICAL,HIGH,MEDIUM reports/trivy-image.json

          echo "== SBOM (CycloneDX) for supply-chain transparency =="
          trivy image --cache-dir "$TRIVY_CACHE_DIR" --quiet --format cyclonedx \
            --output reports/sbom-cyclonedx.json "$IMAGE_REF"
          trivy convert --format template --template "@/opt/trivy/contrib/html.tpl" \
            --output reports/trivy-image.html reports/trivy-image.json || true
        '''
        script {
          // Apply the severity policy across all scanners (0 = pass, 1 = fail, 2 = unstable)
          def gate = sh(script: 'bash scripts/security-summary.sh reports', returnStatus: true)
          if (gate == 1) {
            error('Security gate failed: fixable CRITICAL vulnerability, leaked secret or HIGH misconfiguration (see security-summary.md)')
          } else if (gate == 2) {
            unstable('Security gate: fixable HIGH vulnerabilities found - review security-summary.md')
          }
        }
      }
      post {
        always {
          archiveArtifacts artifacts: 'reports/trivy-*.json, reports/trivy-image.html, reports/npm-audit.json, reports/sbom-cyclonedx.json, reports/security-summary.md',
                           allowEmptyArchive: true
          publishHTML(target: [reportName: 'Trivy Image Report', reportDir: 'reports', reportFiles: 'trivy-image.html',
                               keepAll: true, alwaysLinkToLastBuild: true, allowMissing: true])
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5. DEPLOY - staging environment (Docker Compose), health-gated, auto-rollback
    // -----------------------------------------------------------------------
    stage('Deploy (Staging)') {
      steps {
        withCredentials([string(credentialsId: 'staging-jwt-secret', variable: 'JWT_SECRET'),
                         string(credentialsId: 'chaos-token', variable: 'CHAOS_TOKEN')]) {
          sh 'bash deploy/deploy.sh staging "$IMAGE_REF" "$APP_VERSION"'
        }
        script {
          // Post-deployment acceptance tests against the running staging container
          def smoke = sh(returnStatus: true, script: '''
            BASE_URL=http://taskflow-staging:3000 EXPECTED_ENV=staging EXPECTED_VERSION="$APP_VERSION" \
            SMOKE_ENV=staging npm run test:smoke
          ''')
          if (smoke != 0) {
            withCredentials([string(credentialsId: 'staging-jwt-secret', variable: 'JWT_SECRET'),
                             string(credentialsId: 'chaos-token', variable: 'CHAOS_TOKEN')]) {
              sh 'bash deploy/rollback.sh staging || true'
            }
            error('Staging smoke tests failed - staging rolled back, release blocked')
          }
        }
      }
      post {
        always {
          junit testResults: 'reports/junit/smoke-staging-results.xml', allowEmptyResults: true
        }
        success {
          echo 'Staging is live at http://localhost:8001'
        }
      }
    }

    // -----------------------------------------------------------------------
    // 6. RELEASE - promote the tested image to production, tag & version it
    // -----------------------------------------------------------------------
    stage('Release (Production)') {
      when {
        expression { env.GIT_BRANCH == null || env.GIT_BRANCH == 'main' || env.GIT_BRANCH.endsWith('/main') }
      }
      steps {
        script {
          if (params.REQUIRE_APPROVAL) {
            timeout(time: 30, unit: 'MINUTES') {
              input message: "Promote ${env.APP_VERSION} to production?", ok: 'Release'
            }
          }
          env.RELEASE_TAG = "v${env.APP_VERSION}"
        }
        // Promote: same image digest, new release tags (no rebuild between staging and production)
        sh '''
          set -e
          for tag in "$BASE_VERSION" stable production; do
            docker tag "$IMAGE_REF" "$REGISTRY/$IMAGE_NAME:$tag"
            docker push "$REGISTRY/$IMAGE_NAME:$tag"
          done
          bash scripts/release-notes.sh "$APP_VERSION" "$IMAGE_REF"
        '''
        withCredentials([string(credentialsId: 'production-jwt-secret', variable: 'JWT_SECRET'),
                         string(credentialsId: 'chaos-token', variable: 'CHAOS_TOKEN')]) {
          sh 'bash deploy/deploy.sh production "$IMAGE_REF" "$APP_VERSION"'
        }
        script {
          def smoke = sh(returnStatus: true, script: '''
            BASE_URL=http://taskflow-production:3000 EXPECTED_ENV=production EXPECTED_VERSION="$APP_VERSION" \
            SMOKE_ENV=production npm run test:smoke
          ''')
          if (smoke != 0) {
            withCredentials([string(credentialsId: 'production-jwt-secret', variable: 'JWT_SECRET'),
                             string(credentialsId: 'chaos-token', variable: 'CHAOS_TOKEN')]) {
              sh 'bash deploy/rollback.sh production || true'
            }
            error('Production verification failed - automatically rolled back to the previous release')
          }
        }
        // Git tag marks exactly which commit is in production
        withCredentials([usernamePassword(credentialsId: 'github-credentials',
                                          usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
          sh '''
            set -e
            git -c user.name="Jenkins" -c user.email="jenkins@taskflow.local" \
              tag -a "$RELEASE_TAG" -m "Release $APP_VERSION (Jenkins build $BUILD_NUMBER, image $IMAGE_REF)" -f
            if [ "$GH_TOKEN" != "none" ] && [ -n "$GH_TOKEN" ]; then
              REPO_PATH="${GIT_URL#https://}"
              git push "https://${GH_USER}:${GH_TOKEN}@${REPO_PATH}" "refs/tags/$RELEASE_TAG" -f
              echo "Pushed git tag $RELEASE_TAG to GitHub"
            else
              echo "No GitHub token configured - tag $RELEASE_TAG created locally only"
            fi
          '''
        }
      }
      post {
        always {
          junit testResults: 'reports/junit/smoke-production-results.xml', allowEmptyResults: true
          archiveArtifacts artifacts: 'reports/RELEASE_NOTES.md', allowEmptyArchive: true
        }
        success {
          echo "Production is live at http://localhost:8000 running ${env.APP_VERSION}"
        }
      }
    }

    // -----------------------------------------------------------------------
    // 7. MONITORING & ALERTING - Prometheus/Grafana/Alertmanager integration
    // -----------------------------------------------------------------------
    stage('Monitoring & Alerting') {
      when {
        expression { env.GIT_BRANCH == null || env.GIT_BRANCH == 'main' || env.GIT_BRANCH.endsWith('/main') }
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'grafana-admin',
                                          usernameVariable: 'GRAFANA_USER', passwordVariable: 'GRAFANA_PASSWORD')]) {
          script {
            def status = sh(returnStatus: true, script: 'bash scripts/monitoring-check.sh')
            if (status == 1) {
              error('Monitoring integration failed - production is not being monitored')
            } else if (status == 2) {
              unstable('Critical alerts are firing for production after the release')
            }
          }
          script {
            if (params.SIMULATE_INCIDENT != 'none') {
              withCredentials([string(credentialsId: 'chaos-token', variable: 'CHAOS_TOKEN')]) {
                sh "bash scripts/simulate-incident.sh ${params.SIMULATE_INCIDENT}"
              }
            }
          }
        }
      }
    }
  }

  post {
    success {
      mail to: "${env.TEAM_EMAIL}",
           subject: "SUCCESS: TaskFlow ${env.APP_VERSION} released to production",
           body: "Build ${env.BUILD_URL}\nVersion ${env.APP_VERSION} (commit ${env.GIT_SHORT}) passed all 7 stages.\nProduction: http://localhost:8000\nDashboard: http://localhost:3000/d/taskflow-overview"
    }
    unstable {
      mail to: "${env.TEAM_EMAIL}",
           subject: "UNSTABLE: TaskFlow ${env.APP_VERSION}",
           body: "Build ${env.BUILD_URL} finished with warnings (security findings or firing alerts). Please review."
    }
    failure {
      mail to: "${env.TEAM_EMAIL}",
           subject: "FAILED: TaskFlow pipeline #${env.BUILD_NUMBER}",
           body: "Build ${env.BUILD_URL}console failed. Nothing was promoted past the failing stage."
    }
    always {
      sh 'docker image prune -f --filter "until=72h" > /dev/null 2>&1 || true'
    }
  }
}
