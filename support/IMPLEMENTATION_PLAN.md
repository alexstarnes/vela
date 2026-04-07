# Vela — Implementation Plan

> Agent orchestration UI layer built on Mastra + Next.js.
> This document is the single source of truth for Claude Code implementation.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Tech Stack](#3-tech-stack)
4. [Project Structure](#4-project-structure)
5. [Database Schema](#5-database-schema)
6. [Implementation Phases](#6-implementation-phases)
7. [Phase 1: Foundation](#7-phase-1-foundation)
8. [Phase 2: Core Loop](#8-phase-2-core-loop)
9. [Phase 3: Agent Execution](#9-phase-3-agent-execution)
10. [Phase 4: UI Views](#10-phase-4-ui-views)
11. [Phase 5: Differentiation Features](#11-phase-5-differentiation-features)
12. [Model Configuration](#12-model-configuration)
13. [Key Patterns & Conventions](#13-key-patterns--conventions)
14. [Environment Variables](#14-environment-variables)
15. [Deployment](#15-deployment)

---

## 1. Project Overview

**Vela** is a self-hosted agent orchestration UI that sits on top of Mastra. It provides a task-management-style interface for creating, scheduling, and managing a fleet of AI agents that do dev work and research autonomously.

### Core Principles

- **Single user, cloud deployed** — runs on Railway as one Next.js process
- **Mastra embedded** — `@mastra/core` imported directly, not a separate service
- **Hybrid model routing** — Claude API for complex tasks, local Ollama models (via Cloudflare Tunnel) for simple/cheap tasks
- **Autonomous delegation** — agents can create tasks for other agents
- **Append-only event sourcing** — every state change is an immutable event
- **Stateless agents, stateful orchestrator** — all state lives in Postgres

### What Vela Is NOT

- Not a chat interface (that's V2+)
- Not multi-user (single user with env var auth for MVP)
- Not framework-agnostic (tightly coupled to Mastra by design)

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Railway (Cloud)                        │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Next.js App (single process)           │  │
│  │                                                     │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │  │
│  │  │  UI      │  │  API     │  │  Mastra Instance  │  │  │
│  │  │  (React) │→ │  Routes  │→ │  - Agents         │  │  │
│  │  │          │  │          │  │  - Workflows       │  │  │
│  │  │          │  │          │  │  - Memory          │  │  │
│  │  │          │  │          │  │  - Tools (MCP)     │  │  │
│  │  └──────────┘  └──────────┘  └────────┬───────────┘  │  │
│  │                                       │              │  │
│  │                              ┌────────┴───────────┐  │  │
│  │                              │   Scheduler        │  │  │
│  │                              │   (node-cron)      │  │  │
│  │                              └────────────────────┘  │  │
│  └───────────────────┬────────────────────┬─────────────┘  │
│                      │                    │                 │
│              ┌───────┴──────┐    ┌────────┴──────────┐     │
│              │  Postgres    │    │  Cloud Model APIs  │     │
│              │  (Railway)   │    │  - Anthropic       │     │
│              └──────────────┘    │  - OpenAI (future) │     │
│                                  └───────────────────┘     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Cloudflare Tunnel   │
                    │  (to local machine)  │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Local Mac (M2 Max)  │
                    │  Ollama server       │
                    │  - qwen3-coder-next  │
                    │  - qwen3:8b          │
                    └─────────────────────┘
```

### Request Flow

1. User creates/manages tasks via Next.js UI
2. UI calls Next.js API routes (server actions or route handlers)
3. API routes interact with Postgres (via Drizzle) and Mastra instance
4. Scheduler (node-cron) fires heartbeats on configured intervals
5. Heartbeat: picks up open tasks → resolves model (cloud or local) → executes via Mastra agent → writes events
6. Local models accessed via Cloudflare Tunnel URL (falls back to cloud if tunnel offline)

---

## 3. Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | Next.js 15 (App Router) | Server components + server actions |
| Orchestration | @mastra/core | Embedded, not separate service |
| UI Components | shadcn/ui + Tailwind CSS 4 | Radix primitives, composable |
| Database | PostgreSQL | Railway managed instance |
| ORM | Drizzle ORM | Type-safe, lightweight, Postgres driver |
| Scheduler | node-cron | In-process heartbeats |
| Cloud Models | @anthropic-ai/sdk | Claude Sonnet 4, Haiku 4.5 |
| Local Models | Ollama (OpenAI-compat API) | Via Cloudflare Tunnel |
| Auth | Env var password | Simple middleware for MVP |
| Realtime | Server-Sent Events | Live task/heartbeat updates |
| Markdown Editor | @uiw/react-md-editor or similar | For skills editing |
| Package Manager | pnpm | |

---

## 4. Project Structure

```
vela/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root layout with auth check
│   │   ├── page.tsx                  # Dashboard (redirect to /tasks)
│   │   ├── login/
│   │   │   └── page.tsx              # Simple password login
│   │   ├── tasks/
│   │   │   ├── page.tsx              # Task board (kanban view)
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Task detail (thread, events, tool calls)
│   │   ├── agents/
│   │   │   ├── page.tsx              # Agent registry list
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Agent detail (config, budget, activity)
│   │   ├── projects/
│   │   │   ├── page.tsx              # Project list
│   │   │   └── [id]/
│   │   │       └── page.tsx          # Project detail (tasks, skills, goals)
│   │   ├── skills/
│   │   │   └── page.tsx              # Skills manager (global + project)
│   │   ├── scheduler/
│   │   │   └── page.tsx              # Heartbeat schedule overview
│   │   ├── activity/
│   │   │   └── page.tsx              # Global activity feed
│   │   ├── settings/
│   │   │   └── page.tsx              # Model config, tunnel URL, budgets
│   │   └── api/
│   │       ├── heartbeat/
│   │       │   └── route.ts          # Manual heartbeat trigger
│   │       ├── tasks/
│   │       │   └── route.ts          # Task CRUD
│   │       ├── agents/
│   │       │   └── route.ts          # Agent CRUD
│   │       ├── events/
│   │       │   └── stream/
│   │       │       └── route.ts      # SSE endpoint for live updates
│   │       ├── models/
│   │       │   └── route.ts          # List available models (cloud + local)
│   │       └── health/
│   │           └── route.ts          # Ollama tunnel health check
│   │
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts              # Drizzle client
│   │   │   ├── schema.ts             # All table definitions
│   │   │   └── migrations/           # Generated migrations
│   │   ├── mastra/
│   │   │   ├── index.ts              # Mastra instance (singleton)
│   │   │   ├── agents/               # Agent definitions
│   │   │   │   └── factory.ts        # Creates Mastra agents from DB config
│   │   │   ├── tools/                # Custom Mastra tools
│   │   │   │   ├── task-tools.ts     # Create/update tasks, delegate
│   │   │   │   └── project-tools.ts  # Read project context, skills
│   │   │   └── workflows/            # Mastra workflow definitions
│   │   │       └── heartbeat.ts      # Heartbeat workflow
│   │   ├── scheduler/
│   │   │   ├── index.ts              # Cron scheduler setup
│   │   │   ├── heartbeat.ts          # Heartbeat execution logic
│   │   │   └── budget.ts             # Budget check/enforcement
│   │   ├── models/
│   │   │   ├── router.ts             # Model routing logic (tier → provider)
│   │   │   ├── anthropic.ts          # Anthropic client wrapper
│   │   │   ├── ollama.ts             # Ollama client (with tunnel health)
│   │   │   └── types.ts              # Model config types
│   │   ├── auth/
│   │   │   └── middleware.ts          # Env var password check
│   │   ├── events/
│   │   │   ├── emitter.ts            # Event bus for SSE
│   │   │   └── logger.ts             # Append event to task_events table
│   │   └── utils/
│   │       ├── constants.ts           # Status enums, defaults
│   │       └── errors.ts             # Error types
│   │
│   ├── components/
│   │   ├── ui/                       # shadcn/ui components (generated)
│   │   ├── layout/
│   │   │   ├── sidebar.tsx           # Main nav sidebar
│   │   │   ├── header.tsx            # Page header with breadcrumbs
│   │   │   └── auth-guard.tsx        # Wraps pages with auth check
│   │   ├── tasks/
│   │   │   ├── task-board.tsx        # Kanban board component
│   │   │   ├── task-card.tsx         # Individual task card
│   │   │   ├── task-detail.tsx       # Task detail panel
│   │   │   ├── task-create-dialog.tsx
│   │   │   └── task-thread.tsx       # Message thread for a task
│   │   ├── agents/
│   │   │   ├── agent-list.tsx
│   │   │   ├── agent-card.tsx
│   │   │   ├── agent-config-form.tsx # Create/edit agent
│   │   │   └── budget-bar.tsx        # Visual budget usage indicator
│   │   ├── projects/
│   │   │   ├── project-list.tsx
│   │   │   └── project-form.tsx
│   │   ├── skills/
│   │   │   ├── skill-editor.tsx      # Markdown editor for skills
│   │   │   └── skill-list.tsx
│   │   ├── scheduler/
│   │   │   ├── schedule-overview.tsx
│   │   │   └── heartbeat-log.tsx
│   │   ├── activity/
│   │   │   └── activity-feed.tsx     # Filterable event stream
│   │   └── models/
│   │       ├── model-selector.tsx    # Dropdown for model assignment
│   │       └── model-status.tsx      # Cloud/local status indicators
│   │
│   └── types/
│       └── index.ts                  # Shared TypeScript types
│
├── drizzle.config.ts                 # Drizzle configuration
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── package.json
├── .env.local                        # Local env vars (gitignored)
├── .env.example                      # Template for env vars
└── README.md
```

---

## 5. Database Schema

All tables use UUIDs as primary keys. All timestamps are `timestamptz`.

### `projects`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK, default gen_random_uuid() |
| name | text | NOT NULL |
| goal | text | What this project is trying to achieve |
| context | text | Additional context injected into agents |
| status | text | 'active' / 'archived', default 'active' |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

### `agents`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| project_id | uuid | FK → projects, nullable (global agents) |
| parent_id | uuid | FK → agents, nullable (top-level agents) |
| name | text | NOT NULL |
| role | text | NOT NULL (e.g., 'engineer', 'researcher', 'lead') |
| system_prompt | text | Base instructions for this agent |
| model_config_id | uuid | FK → model_configs |
| budget_monthly_usd | numeric(10,2) | Monthly budget limit in dollars |
| budget_used_usd | numeric(10,4) | Current month spend |
| budget_reset_at | timestamptz | When current budget period started |
| heartbeat_cron | text | Cron expression (e.g., '*/15 * * * *') |
| heartbeat_enabled | boolean | default true |
| max_iterations | integer | default 10, circuit breaker |
| status | text | 'active' / 'paused' / 'budget_exceeded' |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `skills`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | NOT NULL |
| scope | text | 'global' / 'project' |
| project_id | uuid | FK → projects, nullable (null if global) |
| content_md | text | Markdown content of the skill |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `tasks`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| project_id | uuid | FK → projects, NOT NULL |
| parent_task_id | uuid | FK → tasks, nullable (for sub-tasks) |
| assigned_agent_id | uuid | FK → agents, nullable |
| created_by_agent_id | uuid | FK → agents, nullable (null if user-created) |
| title | text | NOT NULL |
| description | text | |
| status | text | See status machine below |
| priority | text | 'low' / 'medium' / 'high' / 'urgent' |
| locked_by | uuid | FK → agents, for atomic checkout |
| locked_at | timestamptz | When checkout lock was acquired |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Task status state machine:**
```
backlog → open → in_progress → review → done
                    ↓                     ↑
              waiting_for_human ──────────┘
                    ↓
                 blocked
                    ↓
                 cancelled
```

Valid transitions:
- `backlog` → `open` (user or agent promotes to active)
- `open` → `in_progress` (agent picks up via atomic checkout)
- `in_progress` → `review` (agent marks complete, needs human review)
- `in_progress` → `waiting_for_human` (agent needs input)
- `in_progress` → `blocked` (agent cannot proceed)
- `review` → `done` (user approves)
- `review` → `in_progress` (user requests changes)
- `waiting_for_human` → `in_progress` (user provides input, agent resumes)
- `blocked` → `open` (blocker resolved)
- Any → `cancelled`

### `task_events`

Append-only. Never update or delete rows.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| task_id | uuid | FK → tasks, NOT NULL |
| agent_id | uuid | FK → agents, nullable |
| event_type | text | See event types below |
| payload | jsonb | Event-specific data |
| tokens_used | integer | nullable |
| cost_usd | numeric(10,6) | nullable |
| created_at | timestamptz | default now() |

**Event types:**
- `status_change` — payload: `{ from, to, reason }`
- `message` — payload: `{ role: 'agent'|'user'|'system', content }`
- `tool_call` — payload: `{ tool_name, input, output, duration_ms }`
- `model_call` — payload: `{ model, provider, prompt_tokens, completion_tokens }`
- `assignment` — payload: `{ assigned_to, assigned_by }`
- `delegation` — payload: `{ parent_task_id, child_task_id, delegated_to }`
- `budget_warning` — payload: `{ agent_id, usage_pct }`
- `budget_exceeded` — payload: `{ agent_id, budget, used }`
- `heartbeat_start` — payload: `{ agent_id }`
- `heartbeat_end` — payload: `{ agent_id, tasks_processed, total_cost }`
- `error` — payload: `{ message, stack? }`
- `loop_detected` — payload: `{ agent_id, tool_name, count }`

### `model_configs`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| name | text | Display name (e.g., 'Claude Sonnet 4') |
| provider | text | 'anthropic' / 'openai' / 'ollama' |
| model_id | text | Provider-specific ID (e.g., 'claude-sonnet-4-20250514') |
| tier | text | 'fast' / 'standard' / 'premium' |
| is_local | boolean | default false |
| endpoint_url | text | nullable, for Ollama tunnel URL |
| input_cost_per_1m | numeric(10,4) | Cost per 1M input tokens (0 for local) |
| output_cost_per_1m | numeric(10,4) | Cost per 1M output tokens (0 for local) |
| max_context_tokens | integer | |
| is_available | boolean | default true, set false if tunnel offline |
| created_at | timestamptz | |

### `heartbeats`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| agent_id | uuid | FK → agents |
| started_at | timestamptz | |
| completed_at | timestamptz | nullable |
| tasks_processed | integer | default 0 |
| tokens_used | integer | default 0 |
| cost_usd | numeric(10,6) | default 0 |
| status | text | 'running' / 'completed' / 'failed' / 'timeout' |
| error | text | nullable |

### `approvals`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| agent_id | uuid | FK → agents |
| task_id | uuid | FK → tasks, nullable |
| action_type | text | 'task_delegation' / 'budget_override' / 'agent_creation' |
| description | text | Human-readable description of what's being requested |
| payload | jsonb | Action-specific data |
| status | text | 'pending' / 'approved' / 'rejected' |
| reviewer_notes | text | nullable |
| created_at | timestamptz | |
| resolved_at | timestamptz | nullable |

### Indexes

```sql
-- Hot path: scheduler finding open tasks for an agent
CREATE INDEX idx_tasks_status_agent ON tasks(status, assigned_agent_id);

-- Atomic checkout: finding unlocked open tasks
CREATE INDEX idx_tasks_open_unlocked ON tasks(status, project_id) WHERE locked_by IS NULL;

-- Event log queries
CREATE INDEX idx_task_events_task ON task_events(task_id, created_at);
CREATE INDEX idx_task_events_agent ON task_events(agent_id, created_at);

-- Budget queries
CREATE INDEX idx_agents_budget ON agents(status, budget_used_usd);

-- Heartbeat history
CREATE INDEX idx_heartbeats_agent ON heartbeats(agent_id, started_at DESC);
```

---

## 6. Implementation Phases

Build in this order. Each phase produces a working increment.

| Phase | Name | Scope | Estimate |
|-------|------|-------|----------|
| 1 | Foundation | Project scaffold, DB, auth, layout shell | 1-2 days |
| 2 | Core Loop | Projects, agents, tasks CRUD + UI | 2-3 days |
| 3 | Agent Execution | Mastra integration, heartbeat, model routing | 2-3 days |
| 4 | UI Views | Task board, activity feed, scheduler view | 2-3 days |
| 5 | Differentiation | Budget enforcement, loop detection, governance | 2-3 days |

---

## 7. Phase 1: Foundation

### 1.1 — Initialize Project

```bash
pnpm create next-app@latest vela --typescript --tailwind --eslint --app --src-dir
cd vela
pnpm add drizzle-orm postgres @mastra/core @anthropic-ai/sdk
pnpm add -D drizzle-kit @types/node
pnpm add node-cron
pnpm add -D @types/cron
```

### 1.2 — Install shadcn/ui

```bash
pnpm dlx shadcn@latest init
# Add components as needed:
pnpm dlx shadcn@latest add button card dialog dropdown-menu input label
pnpm dlx shadcn@latest add select separator sheet sidebar skeleton
pnpm dlx shadcn@latest add table tabs textarea toast badge avatar
```

### 1.3 — Database Setup

Create `src/lib/db/schema.ts` with all tables defined above using Drizzle's `pgTable` syntax.

Create `drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Create `src/lib/db/index.ts`:
```ts
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

Run initial migration:
```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

### 1.4 — Seed Default Model Configs

Create a seed script `src/lib/db/seed.ts` that inserts default model configs:

```ts
const defaultModels = [
  {
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    model_id: 'claude-sonnet-4-20250514',
    tier: 'standard',
    is_local: false,
    input_cost_per_1m: 3.00,
    output_cost_per_1m: 15.00,
    max_context_tokens: 200000,
  },
  {
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    model_id: 'claude-haiku-4-5-20251001',
    tier: 'fast',
    is_local: false,
    input_cost_per_1m: 0.80,
    output_cost_per_1m: 4.00,
    max_context_tokens: 200000,
  },
  {
    name: 'Qwen3-Coder-Next (Local)',
    provider: 'ollama',
    model_id: 'qwen3-coder-next',
    tier: 'standard',
    is_local: true,
    endpoint_url: null, // Set via OLLAMA_TUNNEL_URL env
    input_cost_per_1m: 0,
    output_cost_per_1m: 0,
    max_context_tokens: 32768,
  },
  {
    name: 'Qwen3 8B (Local)',
    provider: 'ollama',
    model_id: 'qwen3:8b',
    tier: 'fast',
    is_local: true,
    endpoint_url: null,
    input_cost_per_1m: 0,
    output_cost_per_1m: 0,
    max_context_tokens: 32768,
  },
];
```

### 1.5 — Auth Middleware

Create `src/lib/auth/middleware.ts`:

Simple approach: check a session cookie against `process.env.VELA_PASSWORD`. Login page sets an HTTP-only cookie. Middleware on all routes (except `/login` and `/api/health`) checks the cookie.

```ts
// Pseudocode — implement with Next.js middleware.ts
export function isAuthenticated(request: Request): boolean {
  const cookie = request.cookies.get('vela_session');
  if (!cookie) return false;
  // Cookie value is a hash of VELA_PASSWORD + a salt
  return verifySession(cookie.value);
}
```

Also create `src/app/login/page.tsx` — simple form, password input, POST to set cookie.

### 1.6 — Layout Shell

Create the app layout with a sidebar navigation:

**Sidebar nav items:**
- 📋 Tasks (`/tasks`)
- 🤖 Agents (`/agents`)
- 📁 Projects (`/projects`)
- 📝 Skills (`/skills`)
- ⏰ Scheduler (`/scheduler`)
- 📊 Activity (`/activity`)
- ⚙️ Settings (`/settings`)

Use shadcn/ui `Sidebar` component. Dark theme by default (match the aesthetic of the research doc).

---

## 8. Phase 2: Core Loop

### 2.1 — Projects CRUD

- **List page** (`/projects`): Cards showing name, goal, task count, active agents
- **Detail page** (`/projects/[id]`): Edit name/goal/context, view tasks, manage project skills
- **Create dialog**: Name, goal, context fields
- Server actions for create/update/archive

### 2.2 — Agents CRUD

- **List page** (`/agents`): Cards with name, role, model, budget usage bar, status indicator
- **Detail page** (`/agents/[id]`): Full config form, recent activity, heartbeat history
- **Create/Edit form** fields:
  - Name, role (free text)
  - System prompt (textarea)
  - Model selector (dropdown of model_configs)
  - Project assignment (optional)
  - Parent agent (optional, dropdown of existing agents)
  - Budget (monthly USD limit)
  - Heartbeat cron (with human-readable preview, e.g., "Every 15 minutes")
  - Max iterations (circuit breaker limit)
- Server actions for create/update/pause/activate

### 2.3 — Tasks CRUD

- **Create dialog** fields:
  - Title, description
  - Project (required)
  - Assigned agent (optional — can be auto-assigned)
  - Priority (low/medium/high/urgent)
  - Parent task (optional, for sub-tasks)
- **Detail page** (`/tasks/[id]`):
  - Status badge with valid transition buttons
  - Thread view: chronological list of task_events
  - Assignment info
  - Sub-tasks list (if any)
  - Cost summary (total tokens, total USD)
- Server actions for create/update status/assign

### 2.4 — Skills CRUD

- **List page** (`/skills`): Two sections — Global Skills, Project Skills
- **Skill editor**: Split view — Markdown editor on left, rendered preview on right
- Fields: name, scope (global/project), project_id (if project scope), content_md
- Server actions for create/update/delete

---

## 9. Phase 3: Agent Execution

This is the critical phase. This is where agents actually do work.

### 3.1 — Mastra Instance

Create `src/lib/mastra/index.ts`:

```ts
import { Mastra } from '@mastra/core';

// Singleton Mastra instance
export const mastra = new Mastra({
  // Configure with Postgres for state/memory
});
```

### 3.2 — Agent Factory

`src/lib/mastra/agents/factory.ts`:

Given a DB agent record, create a Mastra `Agent` instance at runtime:

```ts
export async function createMastraAgent(dbAgent: AgentRecord) {
  // 1. Resolve model config from model_configs table
  // 2. Load skills (global + project-specific)
  // 3. Load goal ancestry (project goal → task context)
  // 4. Build system prompt: base prompt + skills + goal context
  // 5. Resolve model provider (Anthropic client or Ollama endpoint)
  // 6. Create Mastra Agent with tools:
  //    - createTask (for delegation)
  //    - updateTaskStatus
  //    - readProjectContext
  //    - searchFiles (if applicable)
  // 7. Return configured agent
}
```

### 3.3 — Agent Tools (Mastra Tools)

Define Mastra tools that agents can call:

**`task-tools.ts`:**
- `create_subtask` — Creates a child task assigned to another agent. Requires: title, description, assignee agent name or role. Writes a `delegation` event.
- `update_task_status` — Transitions current task to a new status. Validates state machine.
- `add_task_message` — Appends a message event to the current task thread.
- `request_human_input` — Sets task to `waiting_for_human` with a question for the user.

**`project-tools.ts`:**
- `get_project_context` — Returns project goal, context, and skills.
- `list_project_tasks` — Returns other tasks in the same project for awareness.

### 3.4 — Model Router

`src/lib/models/router.ts`:

```ts
export async function resolveModel(modelConfigId: string): Promise<ModelClient> {
  const config = await getModelConfig(modelConfigId);

  if (config.provider === 'ollama') {
    const tunnelUrl = process.env.OLLAMA_TUNNEL_URL;
    // Health check: try to reach Ollama
    const isOnline = await checkOllamaHealth(tunnelUrl);

    if (isOnline) {
      return createOllamaClient(tunnelUrl, config.model_id);
    } else {
      // Fallback: find a cloud model in the same tier
      const fallback = await getFallbackModel(config.tier);
      console.warn(`Ollama offline, falling back to ${fallback.name}`);
      return createAnthropicClient(fallback.model_id);
    }
  }

  if (config.provider === 'anthropic') {
    return createAnthropicClient(config.model_id);
  }

  throw new Error(`Unknown provider: ${config.provider}`);
}
```

**Ollama client** uses the OpenAI-compatible endpoint:
```ts
// Base URL: OLLAMA_TUNNEL_URL + '/v1'
// Uses standard OpenAI chat completions format
// Model name: config.model_id (e.g., 'qwen3-coder-next')
```

**Anthropic client** uses `@anthropic-ai/sdk` directly, or via Mastra's model router.

### 3.5 — Heartbeat Execution

`src/lib/scheduler/heartbeat.ts`:

This is the core execution loop. Called by cron on each agent's schedule.

```ts
export async function executeHeartbeat(agentId: string): Promise<void> {
  // 1. Check agent status (active? not budget_exceeded?)
  const agent = await getAgent(agentId);
  if (agent.status !== 'active') return;

  // 2. Check budget
  if (agent.budget_used_usd >= agent.budget_monthly_usd) {
    await pauseAgent(agentId, 'budget_exceeded');
    await logEvent({ type: 'budget_exceeded', ... });
    return;
  }

  // 3. Create heartbeat record
  const heartbeat = await createHeartbeat(agentId);

  // 4. Find open tasks assigned to this agent (atomic checkout)
  const task = await checkoutNextTask(agentId);
  // Uses: UPDATE tasks SET locked_by = $1, locked_at = now(), status = 'in_progress'
  //       WHERE assigned_agent_id = $1 AND status = 'open' AND locked_by IS NULL
  //       ORDER BY priority DESC, created_at ASC LIMIT 1
  //       RETURNING *

  if (!task) {
    await completeHeartbeat(heartbeat.id, { tasks_processed: 0 });
    return;
  }

  // 5. Build agent context
  //    - Task title + description
  //    - Goal ancestry (task → project goal)
  //    - Relevant skills (global + project)
  //    - Recent task events (last 10)
  const context = await buildAgentContext(agent, task);

  // 6. Create Mastra agent instance
  const mastraAgent = await createMastraAgent(agent);

  // 7. Execute with iteration limit
  let iterations = 0;
  const maxIter = agent.max_iterations || 10;
  const toolCallTracker = new Map<string, number>(); // For loop detection

  try {
    const result = await mastraAgent.generate(context.prompt, {
      // Mastra handles the agent loop internally
      // We track via event callbacks
      onToolCall: (toolCall) => {
        const key = `${toolCall.name}:${JSON.stringify(toolCall.input)}`;
        const count = (toolCallTracker.get(key) || 0) + 1;
        toolCallTracker.set(key, count);

        if (count >= 3) {
          // Loop detected!
          logEvent({ type: 'loop_detected', ... });
          throw new LoopDetectedError(toolCall.name, count);
        }

        iterations++;
        if (iterations >= maxIter) {
          throw new MaxIterationsError(maxIter);
        }
      },
      onTokenUsage: (usage) => {
        // Track cumulative token usage for budget
      }
    });

    // 8. Log result events
    await logEvent({ type: 'message', payload: { role: 'agent', content: result.text } });

    // 9. Update budget
    await updateAgentBudget(agentId, totalCost);

    // 10. Check budget warning (80%)
    if (agent.budget_used_usd + totalCost >= agent.budget_monthly_usd * 0.8) {
      await logEvent({ type: 'budget_warning', ... });
    }

  } catch (error) {
    if (error instanceof LoopDetectedError) {
      await updateTaskStatus(task.id, 'blocked', 'Loop detected');
      await pauseAgent(agentId, 'loop_detected');
    } else {
      await logEvent({ type: 'error', payload: { message: error.message } });
    }
  } finally {
    // 11. Release task lock
    await releaseTaskLock(task.id);

    // 12. Complete heartbeat record
    await completeHeartbeat(heartbeat.id, {
      tasks_processed: 1,
      tokens_used: totalTokens,
      cost_usd: totalCost,
    });
  }
}
```

### 3.6 — Scheduler Setup

`src/lib/scheduler/index.ts`:

```ts
import cron from 'node-cron';

// On app startup, load all active agents and schedule their heartbeats
export async function initializeScheduler() {
  const agents = await getActiveAgents();

  for (const agent of agents) {
    if (agent.heartbeat_enabled && agent.heartbeat_cron) {
      cron.schedule(agent.heartbeat_cron, () => {
        executeHeartbeat(agent.id).catch(console.error);
      });
    }
  }
}

// Called when agent config changes — reschedule
export async function rescheduleAgent(agentId: string) {
  // Stop existing cron job for this agent
  // Create new one with updated config
}
```

Initialize in `src/app/layout.tsx` or a custom server entry point (see Deployment section for Railway considerations with cron in serverless-like environments).

**Important:** Since Next.js on Railway runs as a persistent Node.js process (not serverless), `node-cron` works fine. The scheduler initializes once on server start.

---

## 10. Phase 4: UI Views

### 4.1 — Task Board (Kanban)

`/tasks` page with columns for each status:
- **Backlog** | **Open** | **In Progress** | **Review** | **Done**
- Each column shows task cards (title, assigned agent avatar, priority badge, cost)
- Drag-and-drop between columns (use `@dnd-kit/core` or similar)
- Filter by: project, agent, priority
- "New Task" button opens create dialog
- Click card → navigates to `/tasks/[id]`

### 4.2 — Task Detail

`/tasks/[id]` page:
- **Header**: Title, status badge, priority, assigned agent, project
- **Actions**: Status transition buttons (only valid transitions shown)
- **Thread**: Chronological list of task_events, styled differently by type:
  - `message` → chat bubble (agent messages left, user messages right)
  - `tool_call` → collapsible code block showing input/output
  - `status_change` → inline status badge change
  - `delegation` → link to child task
  - `error` → red alert block
- **Sidebar**: Cost summary, sub-tasks, goal ancestry breadcrumb
- **User input**: Text area at bottom for adding messages / responding to `waiting_for_human`

### 4.3 — Activity Feed

`/activity` page:
- Real-time (SSE) stream of all task_events across all agents
- Filter by: agent, project, event type, time range
- Each event shows: timestamp, agent name, event type badge, summary
- Click event → links to relevant task

### 4.4 — Scheduler Overview

`/scheduler` page:
- Table of all agents with: name, cron expression, next run time, last run time, last run status, heartbeat enabled toggle
- "Run Now" button per agent (triggers manual heartbeat)
- Recent heartbeat log (last 20 across all agents)

### 4.5 — Settings

`/settings` page:
- **Model Configuration**: List of model_configs, edit costs, add new models
- **Ollama Connection**: Tunnel URL input, health check button, status indicator
- **Budget Defaults**: Default monthly budget for new agents
- **Danger Zone**: Reset budgets, clear events older than X days

---

## 11. Phase 5: Differentiation Features

### 5.1 — Budget Enforcement (Atomic)

- Budget check runs BEFORE agent execution in heartbeat
- Budget deduction runs AFTER execution as a Postgres transaction
- 80% warning → logs event + shows warning badge on agent card
- 100% exceeded → auto-pauses agent, blocks new task checkout
- "Override" button on agent detail page (resets to active, logs approval event)
- Budget auto-resets monthly (check `budget_reset_at`, reset on heartbeat if past month boundary)

### 5.2 — Loop Detection

- Track tool calls per heartbeat in-memory: `Map<string, number>` keyed by `toolName:inputHash`
- Same tool + same input ≥ 3 times → throw `LoopDetectedError`
- Agent auto-pauses, task moves to `blocked`
- Event logged with details
- User can investigate in task thread, then manually resume

### 5.3 — Autonomous Delegation (Governance)

When an agent calls `create_subtask`:
1. Check if the action requires approval (configurable per action type)
2. If approval required → create `approvals` record, set task to `waiting_for_human`
3. Show in a notifications/approval banner at the top of the UI
4. User approves/rejects → task either proceeds or is cancelled
5. If no approval required → task created directly

Default governance rules:
- Task delegation within same project: **auto-approved**
- Budget override requests: **requires approval**
- Agent creation (future): **requires approval**

### 5.4 — Ollama Fallback Handling

- On each heartbeat, before model call, health-check the Ollama tunnel
- If offline: log a warning, swap to the cloud model in the same tier
- Agent card shows model currently in use (may differ from configured if fallback active)
- Settings page shows Ollama status prominently
- When tunnel comes back online, next heartbeat automatically uses local model again

---

## 12. Model Configuration

### Default Model Tiers

| Tier | Cloud Model | Local Model | Use Case |
|------|------------|-------------|----------|
| fast | Claude Haiku 4.5 | Qwen3:8b | Routing, triage, simple summarization |
| standard | Claude Sonnet 4 | Qwen3-Coder-Next | Code generation, complex reasoning |
| premium | Claude Sonnet 4 | (no local equivalent) | Critical tasks, complex multi-step |

### How Model Routing Works

1. Each agent has a `model_config_id` pointing to a specific model
2. The model router resolves the actual client at execution time
3. If the configured model is local and Ollama is offline → fallback to cloud in same tier
4. Cost tracking records actual model used (not configured), so budget is accurate

### Ollama Integration Details

- Ollama exposes OpenAI-compatible API at `{OLLAMA_TUNNEL_URL}/v1/chat/completions`
- Use the OpenAI SDK or fetch directly — same request format
- Model name in request body: `model: "qwen3-coder-next"`
- No API key needed (tunnel provides security)

### Cloudflare Tunnel Setup (Reference for User)

```bash
# Install cloudflared
brew install cloudflared

# Start tunnel pointing to local Ollama
cloudflared tunnel --url http://localhost:11434

# This outputs a URL like: https://random-words.trycloudflare.com
# Set this as OLLAMA_TUNNEL_URL in Railway env vars

# For a persistent named tunnel:
cloudflared tunnel create ollama
cloudflared tunnel route dns ollama ollama.yourdomain.com
cloudflared tunnel run ollama --url http://localhost:11434
```

---

## 13. Key Patterns & Conventions

### Server Actions vs API Routes

- **Server Actions** (preferred): For mutations triggered by UI (create task, update agent, etc.)
- **API Routes**: For SSE streams, manual heartbeat trigger, health checks, and anything that needs to be called programmatically

### Error Handling

- All DB operations wrapped in try/catch
- Heartbeat errors never crash the process — caught and logged as events
- Model call failures → retry once, then mark task as `blocked` with error event

### Type Safety

- All DB types inferred from Drizzle schema using `typeof schema.tableName.$inferSelect`
- Shared types in `src/types/index.ts`
- Zod schemas for API input validation (reuse Drizzle's insert types where possible)

### Event Logging

Every significant action goes through the event logger:

```ts
// src/lib/events/logger.ts
export async function logTaskEvent(event: {
  taskId: string;
  agentId?: string;
  type: EventType;
  payload: Record<string, unknown>;
  tokensUsed?: number;
  costUsd?: number;
}) {
  await db.insert(taskEvents).values({
    id: crypto.randomUUID(),
    task_id: event.taskId,
    agent_id: event.agentId,
    event_type: event.type,
    payload: event.payload,
    tokens_used: event.tokensUsed,
    cost_usd: event.costUsd,
  });

  // Also emit via SSE for live updates
  eventEmitter.emit('task_event', event);
}
```

### Naming Conventions

- DB columns: `snake_case`
- TypeScript: `camelCase` for variables, `PascalCase` for types/components
- Files: `kebab-case.ts` for modules, `PascalCase.tsx` for components (or kebab — be consistent)
- Drizzle will handle the mapping between snake_case DB and camelCase TS

---

## 14. Environment Variables

```bash
# === Required ===
DATABASE_URL=postgresql://user:pass@host:5432/vela
ANTHROPIC_API_KEY=sk-ant-...
VELA_PASSWORD=your-secure-password-here

# === Local Models ===
OLLAMA_TUNNEL_URL=https://your-tunnel.trycloudflare.com
# Leave empty if not using local models

# === Optional ===
OPENAI_API_KEY=sk-...          # Future: for OpenAI model support
NODE_ENV=production
PORT=3000
```

---

## 15. Deployment

### Railway Setup

1. Create a new Railway project
2. Add a PostgreSQL service
3. Add a Node.js service pointing to your Git repo
4. Set environment variables (see above)
5. Build command: `pnpm build`
6. Start command: `pnpm start`
7. Railway provides HTTPS automatically

### Important: Cron in Persistent Process

Since Railway runs Next.js as a persistent Node process (not serverless), `node-cron` initializes on startup and runs in-process. This is correct behavior for our scheduler.

If you later want to decouple the scheduler, Railway supports cron jobs as separate services.

### Database Migrations

Run migrations as part of deploy:
```json
// package.json
{
  "scripts": {
    "db:migrate": "drizzle-kit migrate",
    "build": "pnpm db:migrate && next build"
  }
}
```

### Cloudflare Tunnel (Local Machine)

Keep `cloudflared` running on your Mac. Consider using a LaunchAgent to auto-start on boot:

```xml
<!-- ~/Library/LaunchAgents/com.cloudflare.tunnel.plist -->
<plist version="1.0">
<dict>
  <key>Label</key><string>com.cloudflare.tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/cloudflared</string>
    <string>tunnel</string>
    <string>run</string>
    <string>ollama</string>
    <string>--url</string>
    <string>http://localhost:11434</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
```

---

## Summary: What to Build First

**Start here → Phase 1 → Phase 2 → Phase 3.** That gives you a working system where you can create projects, define agents, create tasks, and have agents pick up and execute tasks on a heartbeat schedule using either Claude API or local Ollama models.

Phase 4 polishes the UI. Phase 5 adds the safety and governance features that make it production-trustworthy.

The single most important thing to get right: **the heartbeat loop** (Phase 3.5). Everything else is CRUD. The heartbeat is where orchestration actually happens.
