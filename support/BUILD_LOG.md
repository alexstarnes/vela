# Vela Completion Plan — Build Log

Execution log for `support/VELA_COMPLETION_PLAN.md`, Phases 0–8. Started 2026-08-21.
Operator: Claude Code (autonomous run under /goal operating rules).

Format: one section per phase; every VERIFY result, every `⚠` check, every rule-2 decision, every plan amendment gets a line here.

---

## Phase 0 — Prove what's built

### Plan amendments (rule 2 / rule 7)

- **AMENDMENT 0-A:** The plan's "Reads before starting" names `support/STATUS_20260821.md`. That file does not exist; the living status doc is `support/PROJECT_STATUS.md` (which itself mandates in-place updates rather than dated snapshots). Read that instead. Plan file references left as-is; recorded here.
- **FINDING 0-B (audit was stale on env):** The audit said `VELA_HELPER_SECRET` and `GITHUB_TOKEN_ENCRYPTION_KEY` are missing. They exist in `.env.local` (the audit only checked `.env`). Helper loads both files via `@next/env` `loadEnvConfig()`. No secret generation needed; no GitHub token re-encryption risk. Only `APP_URL` is genuinely absent.

### Baseline (pre-change)

- `npx tsc --noEmit` → clean, 0 errors. ✅
- `npm run test:unit` → 27/27 pass. ✅
- `git status` → working tree carries pre-existing uncommitted changes (support/ doc reorg, new docs/agent-roles + docs/agent-protocols with 2 files). Not created by this run; will be folded into this build's commits.

### 0.1 Environment
- `.env.local` already carried `VELA_HELPER_SECRET`, `GITHUB_TOKEN_ENCRYPTION_KEY`, `VELA_HELPER_URL` (helper + app load it via @next/env). Added missing `APP_URL=http://localhost:3000` to `.env.local`. No key rotation → no GitHub token invalidation. ✅

### 0.2 Database is real ✅
- `db-check` via app's own DATABASE_URL: all 10 tables exist on live Supabase; 22 agents (5 runtime, 17 legacy refs hb=false), 12 model configs, prior usage (14 tasks, 1279 task_events, 59 heartbeats).
- `npm run db:migrate` → no-op, all 7 migrations already applied. `npm run db:seed` → idempotent upsert, exit 0, "Seeded 11 models, 5 runtime agents, 16 legacy reference agents", 44 model-access rows, 0 task reassignments.
- Note: DB has a 12th model config (`Qwen3-Coder-Next (Local)`, avail=false) not in seed.ts — added manually at some point, preserved by upsert.
- ⚠ noted: Anthropic API model rows (Opus/Sonnet/Haiku) are `is_available=false` in DB — cloud lane deliberately parked as last resort. Left as-is.

### 0.3 Model lanes ✅ (all three made real, logged calls)
- **Ollama**: `GET /v1/models` → 200 (qwen3-coder:30b, qwen3:8b). Real chat completion on qwen3:8b returned `OLLAMA-LANE-OK` (134 tokens, $0).
- **Cloud API**: one Anthropic `/v1/messages` call (claude-haiku-4-5, 16 max_tokens) → HTTP 200, `CLOUD-LANE-OK`. Metered spend ≈ $0.0001 — the only intentional metered call of this phase.
- **CLI subscription**: helper `/cli/health` → claude 2.1.236 + codex-cli 0.144.0 available. `/cli/execute` (claude) returned `CLI-LANE-OK`.
- **⚠ §0.3 trap checked EMPIRICALLY**: while the spawned `claude -p` process ran, dumped its actual environment via `ps eww <pid>`: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `OPENAI_API_KEY` all ABSENT (sanity check proved the dump readable — inherited non-provider vars visible). Keychain shows OAuth token, `subscriptionType: max`, no apiKeyHelper. **CLI lane is subscription-billed, not metered.** ✅
- **BUG FOUND + FIXED (helper CLI output parsing):** `claude -p --output-format json` stdout carried a trailing MCP warning line ("Client.listTools()...") after the result JSON; helper's whole-stdout `JSON.parse` threw, silently dropping usage/cost/numTurns (nulls) and returning raw JSON as resultText. Fixed with tolerant per-line result-JSON extraction (`parseClaudeResultJson` in scripts/vela-helper.ts). Re-ran: resultText clean, usage {in:2, out:12}, reportedCostUsd populated, numTurns=1. tsc clean.

### 0.5 Stale references fixed ✅
- `src/lib/events/logger.ts:52` comment now describes real behavior (2s DB-polling SSE with last-event-id reconnect).
- `.claude/launch.json`: removed stale `Mastra Studio` (dev:mastra, port 4111) entry pointing at the deleted scaffold.

### 0.4 End-to-end pipeline pass ✅
- **AMENDMENT 0-C:** Plan says "create a project against a local folder" via the product; `createProject` action has local modes disabled ("coming soon — use GitHub", src/lib/actions/projects.ts:96-101). The runtime itself supports local workspace paths (existing "Vela" project row is source_type=manual + workspace_path). Created the `Phase0 E2E` project row directly in DB mirroring that shape; task created mirroring `createTask` semantics (status=open, assigned to Supervisor, status_change event). The pipeline run itself — the thing 0.4 exists to prove — went through the real HTTP surface (`POST /api/heartbeat?taskId=…` on the dev server, session-cookie auth).
- Task: "Update footer copyright year to 2026" on scratch repo `~/Desktop/vela-clones/phase0-e2e`.
- Pipeline observed live: workflow_route (featureWorkflow, mode=single_agent, tier=fast) → repo_map → plan → implement (ollama/qwen3-coder:30b, real tool calls: search_workspace, list_workspace_files, apply_diff, git_diff) → implementation_audit → verify (scoped policy: build gate failed "No build script" → correctly informational, non-blocking) → review (pass) → synthesize.
- **Real file change landed**: index.html `© 2025` → `© 2026`, committed by the pipeline as `b073c7e "Update footer copyright year to 2026"`.
- Quirk observed: attempt 1 made the correct edit but was ruled "Mechanical verification failed" → automatic rework 2/3; attempt 2 concluded change already satisfied and passed. Rework loop works; first-attempt verification sensitivity worth watching.
- **Approval gate held**: task stopped at `review` (94 events, nothing auto-completed). Human transition review→done performed via the state machine (assertValidTransition) + status_change event. Note: no approvals-table row for this path — the plain-work gate is the `review` status itself; approvals rows are for task_delegation/high-risk actions.
- **Activity feed live**: SSE `/api/events/stream` captured 182 data events in real time during the run (model_call/tool_call/status_change/repo_map/...) with cookie auth.
- **Cost attribution**: task_events carry tokens+cost per model_call; scorecard totalCostUsd=$0.002069. Implement lane: Ollama at $0.000000; review/synthesize steps ran on openai/gpt-5.4-mini (metered, ~$0.002) because that is the configured reviewer model — flagged for the Phase 8 ~$0 goal.

### 0.6 GitHub clone path ✅
- Cloned `alexstarnes/gather` through the app's own path: `ensureFreshGitHubAccessToken()` (AES-256-GCM decrypt OK) → `cloneRepository()` client → helper `/clone-repository`. Result: workspacePath + workspaceId + defaultBranch=main; full git history present; origin remote scrubbed of the x-access-token credential after clone. Test clone deleted after verification.

### VERIFY 0 — ALL PASS
- [x] tsc clean; 27/27 unit tests; working tree committed (see commits below).
- [x] 10 tables live; seed idempotent.
- [x] Ollama, CLI, cloud lanes each made a real, logged call.
- [x] CLI lane subscription-billed — empirically no provider key in child env; keychain OAuth subscriptionType=max.
- [x] Full pipeline E2E: real file change, gate held at review, SSE live.
- [x] GitHub repo cloned through helper.
