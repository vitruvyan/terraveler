/* Terraveler CI - Jenkins replacement for automatic GitHub Actions gates. */
pipeline {
    agent {
        docker {
            image 'node:22-bookworm-slim'
            reuseNode true
        }
    }
    options {
        skipDefaultCheckout(true)
        disableConcurrentBuilds(abortPrevious: true)
        buildDiscarder(logRotator(numToKeepStr: '20'))
        timeout(time: 30, unit: 'MINUTES')
        timestamps()
    }
    environment {
        POSTGREST_URL = 'https://example.invalid'
        POSTGREST_SERVICE_KEY = 'ci-placeholder'
        SUPABASE_AUTH_URL = 'https://auth.example.invalid'
        SUPABASE_AUTH_KEY = 'ci-placeholder'
        NEXT_PUBLIC_SUPABASE_URL = 'https://auth.example.invalid'
        NEXT_PUBLIC_SUPABASE_ANON_KEY = 'ci-placeholder'
        NPM_CONFIG_AUDIT = 'false'
        NPM_CONFIG_FUND = 'false'
    }
    stages {
        stage('Checkout exact revision') {
            steps {
                sh '''
                    set -eu
                    apt-get update
                    apt-get install -y --no-install-recommends curl git python3
                    rm -rf /var/lib/apt/lists/*
                '''
                script {
                    def scmVars = checkout scm
                    env.CHECKED_OUT_SHA = scmVars.GIT_COMMIT
                }
                sh '''
                    set -eu
                    test -n "${CHECKED_OUT_SHA:-}"
                    ACTUAL_SHA="$(git rev-parse HEAD)"
                    test "$ACTUAL_SHA" = "$CHECKED_OUT_SHA"
                    echo "Terraveler commit: $ACTUAL_SHA"
                '''
            }
        }
        stage('Install') {
            steps {
                sh '''
                    set -eu
                    rm -rf node_modules .next reports
                    node --version
                    npm --version
                    npm ci
                    mkdir -p reports
                '''
            }
        }
        stage('Test and build') {
            parallel {
                stage('Tests') {
                    steps { sh 'npm test' }
                }
                stage('Production build') {
                    steps { sh 'npm run build' }
                }
            }
        }
        stage('Modern MCP smoke') {
            steps {
                sh '''
                    set -eu
                    npm start -- -p 3000 >reports/next.log 2>&1 &
                    server_pid=$!
                    trap 'kill "$server_pid" 2>/dev/null || true' EXIT
                    ready=0
                    for attempt in $(seq 1 30); do
                        if curl -fsS http://127.0.0.1:3000/connect >/dev/null; then
                            ready=1
                            break
                        fi
                        sleep 1
                    done
                    if [ "$ready" -ne 1 ]; then
                        cat reports/next.log
                        exit 1
                    fi
                    curl -fsS -X POST http://127.0.0.1:3000/api/mcp                       -H 'Content-Type: application/json'                       -H 'MCP-Protocol-Version: 2026-07-28'                       -H 'Mcp-Method: server/discover'                       -d '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'                       >reports/discover.json
                    grep -q '2026-07-28' reports/discover.json
                    grep -q 'io.modelcontextprotocol/serverInfo' reports/discover.json
                    curl -fsS -X POST http://127.0.0.1:3000/api/mcp                       -H 'Content-Type: application/json'                       -H 'MCP-Protocol-Version: 2026-07-28'                       -H 'Mcp-Method: tools/list'                       -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'                       >reports/tools.json
                    grep -q 'get_capabilities' reports/tools.json
                    ! grep -q '"name":"register"' reports/tools.json
                    curl -fsS -X POST http://127.0.0.1:3000/api/mcp                       -H 'Content-Type: application/json'                       -H 'MCP-Protocol-Version: 2026-07-28'                       -H 'Mcp-Method: tools/call'                       -H 'Mcp-Name: get_capabilities'                       -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_capabilities","arguments":{},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}'                       >reports/capabilities.json
                    grep -q 'anonymous' reports/capabilities.json
                    grep -q 'publish' reports/capabilities.json
                    status=$(curl -sS -o reports/challenge.json -D reports/challenge.headers -w '%{http_code}'                       -X POST http://127.0.0.1:3000/api/mcp                       -H 'Content-Type: application/json'                       -H 'MCP-Protocol-Version: 2026-07-28'                       -H 'Mcp-Method: tools/call'                       -H 'Mcp-Name: claim_gap'                       -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"claim_gap","arguments":{"gap_id":1},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}')
                    test "$status" = '401'
                    grep -qi '^www-authenticate:.*Bearer' reports/challenge.headers
                    grep -q 'mcp/www_authenticate' reports/challenge.json
                    mismatch=$(curl -sS -o reports/mismatch.json -w '%{http_code}'                       -X POST http://127.0.0.1:3000/api/mcp                       -H 'Content-Type: application/json'                       -H 'MCP-Protocol-Version: 2026-07-28'                       -H 'Mcp-Method: tools/list'                       -H 'Mcp-Name: wrong-name'                       -d '{"jsonrpc":"2.0","id":5,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}')
                    test "$mismatch" = '400'
                    grep -q -- '-32020' reports/mismatch.json
                '''
            }
        }
    }
    post {
        always {
            archiveArtifacts allowEmptyArchive: true, artifacts: 'reports/**'
            deleteDir()
        }
    }
}
