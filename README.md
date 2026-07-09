# Vela

Vela is a self-hosted **agent orchestration platform**: you register projects (local folders or GitHub clones), create tasks, and a supervised pipeline of agents — classify → repo-map → plan → implement → verify → review — writes real code changes into the project workspace, with deterministic verification gates and human approval at the end.

It is a single-user tool by design. One password, one operator, agents working while you're away.

## Architecture

Vela runs as **two processes** with different trust and placement requirements:

| Process | What it does | Where it runs |
|---|---|---|
| **Web app** (`npm run dev` / Docker) | UI, API, task scheduler, heartbeat execution loop, model routing, budgets, verification policy | Anywhere (Railway, VPS, or locally) |
| **vela-helper** (`npm run dev:helper`) | Workspace file access, git operations, shell commands, and headless CLI execution (`claude -p`) | A machine you control, next to your cloned repos — **always-on if you want tasks to run while you're away** |

The web app talks to the helper over HTTP (`VELA_HELPER_URL`) authenticated with a shared secret (`VELA_HELPER_SECRET`). If the web app is deployed remotely, expose the helper to it via a private tunnel (Tailscale, cloudflared) — never on the open internet.

### Execution lanes

Model routing prefers cheaper/private lanes and fails over automatically:

1. **Local models** (Ollama via `OLLAMA_TUNNEL_URL`) — free, private. Health-checked per model; offline models are skipped.
2. **CLI subscription lane** (`claude` CLI via the helper) — implementation work executes headless under your Claude subscription instead of metered API billing. Requires the CLI to be **logged in on the helper machine** (`claude /login`). Usage caps and auth failures are detected, the lane cools down (`VELA_CLI_COOLDOWN_MS`, default 15 min), and work fails over to the API lane automatically.
3. **Cloud APIs** (Anthropic / OpenAI keys) — the lane of last resort, always available as failover.

Which lanes exist is controlled by rows in `model_configs` (see `src/lib/db/seed.ts`); per-agent access is controlled by each runtime agent's `allowedModelIds`.

> **CLI lane constraint:** a CLI-routed task can only execute where its login session lives. If that's your laptop, "runs while I'm away" breaks for CLI-mode tasks — put the helper (and CLI login) on an always-on box for true autonomy.

## Setup

Requirements: Node **>= 22.13**, a Postgres database (Supabase works well — use the pooled URL for `DATABASE_URL` and the direct URL for `DIRECT_URL`).

```bash
git clone <this repo> && cd vela
npm install
cp .env.example .env        # fill in values (see below)
npm run db:migrate          # apply schema (uses DIRECT_URL)
npm run db:seed             # seed model configs + the 5 runtime agents
npm run dev:helper          # terminal 1 — the local bridge (port 4312)
npm run dev                 # terminal 2 — the web app (port 3000)
```

Log in at `http://localhost:3000` with `VELA_PASSWORD`.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres (pooled; `prepare:false` is set for Supavisor) |
| `DIRECT_URL` | migrations | Direct Postgres URL for drizzle-kit |
| `VELA_PASSWORD` | **yes in production** | Single-user login. Unset = dev-only open access; production fails closed (503) |
| `VELA_HELPER_SECRET` | yes | Shared secret between app and helper |
| `VELA_HELPER_URL` | remote deploys | Helper endpoint (default `http://127.0.0.1:4312`) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | at least one | Cloud API lanes |
| `OLLAMA_TUNNEL_URL` | optional | Local model lane (Ollama `/api/tags` must respond) |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_TOKEN_ENCRYPTION_KEY` | for GitHub projects | OAuth flow for repo cloning |
| `VELA_CLI_COOLDOWN_MS` | optional | CLI lane cooldown after caps/auth failures (default 900000) |

## Using it

1. **Projects → Add Project** — pick a local folder or connect GitHub and clone a repo through the helper.
2. **Tasks → New Task** — describe the change; name files explicitly when you can (`"in index.html…"`). Assign the **Supervisor** and the task dispatches immediately.
3. Watch progress in **Activity** (live SSE feed) or the task detail timeline: classification, routing decisions, every tool call, verification gate results, reviewer findings, and cost per step.
4. Verified + reviewed tasks land in **review** status with the diff left uncommitted in the workspace — approve in the UI to mark done, then commit/push from the task tools or your own terminal.

Failed attempts requeue with reviewer/verification feedback injected into the next attempt, escalating model tier as failures accumulate (fast → standard → premium), and stop after 5 failures in `waiting_for_human`.

## Deployment

The repo ships a `Dockerfile` (Next.js standalone) and `railway.json` (health-checked deploys against `/api/health`).

- Deploy the **web app** container to Railway (or any Docker host). Set all env vars above; `VELA_PASSWORD` is mandatory — production fails closed without it.
- Run the **helper** on your own always-on machine: `npm run start:helper` (systemd/launchd service recommended). Point `VELA_HELPER_URL` at it through a private tunnel.
- Log the `claude` CLI in on the helper machine to enable the subscription lane.

## Development

```bash
npm run test          # orchestration unit tests + routing evals
npm run test:unit     # unit tests only
npx tsc --noEmit      # typecheck
npm run dev:mastra    # optional: Mastra Studio scaffold at :4111 (not the product runtime)
```

The product runtime lives in `src/lib/mastra` (embedded) and `src/lib/orchestration` (deterministic policy helpers). The top-level `src/mastra` tree is a standalone studio scaffold, not the app runtime. See `AGENTS.md` for contributor rules and `support/` for architecture docs.
