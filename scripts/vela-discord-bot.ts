/**
 * Vela Discord bot — completion plan Phase 5.
 *
 * A standalone process (NOT part of the Next.js app) that bridges the Vela
 * orchestration loop and a Discord server:
 *
 *   Vela → Discord   consumes /api/events/stream (SSE) and posts approval
 *                     requests, task lifecycle notices, and errors.
 *   Discord → Vela    approve/reject buttons call /api/approvals/:id/*, and
 *                     replies to bot messages are forwarded as task comments.
 *   Slash commands    /vela status|tasks|budget|agents — read-only, queried
 *                     straight from the database (no HTTP round trip).
 *
 * Run with: npx tsx scripts/vela-discord-bot.ts
 *
 * Mirrors scripts/vela-helper.ts's style: one file, no framework, explicit
 * env loading via @next/env so it sees the same .env the web app does.
 *
 * File sections:
 *   1. Config            — env parsing + validation
 *   2. State             — Last-Event-ID persistence (.vela-discord-bot-state.json)
 *   3. Vela client       — session login, authenticated fetch, SSE consumer
 *   4. Discord client     — gateway client + slash command registration
 *   5. Outbound queue     — per-channel rate limiting / coalescing
 *   6. SSE → Discord      — routes task_events onto the right channel
 *   7. Discord → Vela     — approval buttons, reply forwarding, slash commands
 *   8. Bootstrap + shutdown
 */

import './bot-env';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type Message,
  type MessageCreateOptions,
} from 'discord.js';
import { db } from '@/lib/db';
import { agents, approvals, tasks } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

// Env is loaded by ./bot-env (first import) so @/lib/db sees it at load time.

// ─── 1. Config ──────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required to run the Discord bot`);
  }
  return value;
}

const DISCORD_BOT_TOKEN = requireEnv('DISCORD_BOT_TOKEN');
const VELA_PASSWORD = requireEnv('VELA_PASSWORD');

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_CHANNEL_APPROVALS = process.env.DISCORD_CHANNEL_APPROVALS;
const DISCORD_CHANNEL_ACTIVITY = process.env.DISCORD_CHANNEL_ACTIVITY;
const DISCORD_CHANNEL_ERRORS = process.env.DISCORD_CHANNEL_ERRORS;
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

const DISCORD_OPERATOR_IDS = new Set(
  (process.env.DISCORD_OPERATOR_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
);

if (!DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  console.warn('[config] DISCORD_CLIENT_ID/DISCORD_GUILD_ID missing — slash command registration will be skipped.');
}
if (DISCORD_OPERATOR_IDS.size === 0) {
  console.warn('[config] DISCORD_OPERATOR_IDS is empty — no Discord user will be able to approve/reject anything.');
}
for (const [label, id] of [
  ['DISCORD_CHANNEL_APPROVALS', DISCORD_CHANNEL_APPROVALS],
  ['DISCORD_CHANNEL_ACTIVITY', DISCORD_CHANNEL_ACTIVITY],
  ['DISCORD_CHANNEL_ERRORS', DISCORD_CHANNEL_ERRORS],
] as const) {
  if (!id) console.warn(`[config] ${label} is not set — messages destined for it will be dropped.`);
}

const SESSION_COOKIE_NAME = 'vela_session';
const STATE_FILE = path.resolve(process.cwd(), '.vela-discord-bot-state.json');
const STATE_WRITE_THROTTLE_MS = 1000;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// ─── 2. State (Last-Event-ID persistence) ──────────────────────────

interface BotState {
  lastEventId: string | null;
}

const state: BotState = { lastEventId: null };
let lastStateWriteAt = 0;
let pendingStateWrite: NodeJS.Timeout | null = null;

async function loadState(): Promise<void> {
  try {
    const raw = await readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<BotState>;
    state.lastEventId = typeof parsed.lastEventId === 'string' ? parsed.lastEventId : null;
    if (state.lastEventId) {
      console.log(`[state] resuming from last-event-id ${state.lastEventId}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[state] could not read state file, starting fresh:', err);
    }
  }
}

async function writeStateNow(): Promise<void> {
  lastStateWriteAt = Date.now();
  try {
    await writeFile(STATE_FILE, JSON.stringify(state), 'utf8');
  } catch (err) {
    console.warn('[state] failed to persist state file:', err);
  }
}

/** Records the new id immediately but throttles the actual disk write to ~1/s. */
function persistState(lastEventId: string): void {
  state.lastEventId = lastEventId;
  const elapsed = Date.now() - lastStateWriteAt;
  if (elapsed >= STATE_WRITE_THROTTLE_MS) {
    void writeStateNow();
    return;
  }
  if (!pendingStateWrite) {
    pendingStateWrite = setTimeout(() => {
      pendingStateWrite = null;
      void writeStateNow();
    }, STATE_WRITE_THROTTLE_MS - elapsed);
  }
}

async function flushState(): Promise<void> {
  if (pendingStateWrite) {
    clearTimeout(pendingStateWrite);
    pendingStateWrite = null;
  }
  await writeStateNow();
}

// ─── 3. Vela client (login / authenticated fetch / SSE) ────────────

let sessionCookie: string | null = null;

async function login(): Promise<void> {
  const res = await fetch(`${APP_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: VELA_PASSWORD }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Vela login failed (${res.status}): ${body}`);
  }

  const setCookies =
    typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : res.headers.get('set-cookie')
        ? [res.headers.get('set-cookie') as string]
        : [];

  const found = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (!found) {
    throw new Error('Vela login response did not include a session cookie');
  }
  sessionCookie = found.split(';')[0]!;
  console.log('[vela] session established');
}

/**
 * Authenticated fetch against the Vela app. On a 401 or a redirect (the auth
 * middleware sends unauthenticated requests to /login) it re-logs in once and
 * retries the same request exactly once before giving up.
 */
async function velaFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  if (!sessionCookie) {
    await login();
  }

  const withCookie = (): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Cookie: sessionCookie ?? '' },
  });

  let res = await fetch(`${APP_URL}${pathname}`, withCookie());

  if (res.status === 401 || res.redirected) {
    await login();
    res = await fetch(`${APP_URL}${pathname}`, withCookie());
  }

  return res;
}

interface TaskEventPayload {
  id: string;
  taskId: string;
  taskTitle: string | null;
  agentName: string | null;
  eventType: string;
  payload: Record<string, unknown> | null;
  tokensUsed: number | null;
  costUsd: string | null;
  createdAt: string;
}

let sseConnected = false;
let sseReconnectAttempts = 0;
let shuttingDown = false;

async function runSseLoop(): Promise<void> {
  const MIN_BACKOFF_MS = 1000;
  const MAX_BACKOFF_MS = 60000;
  let backoff = MIN_BACKOFF_MS;

  while (!shuttingDown) {
    try {
      await connectAndConsume();
      backoff = MIN_BACKOFF_MS; // the stream ended cleanly — reset backoff before reconnecting
    } catch (err) {
      console.error('[sse] connection error:', err instanceof Error ? err.message : err);
    }

    sseConnected = false;
    if (shuttingDown) break;

    sseReconnectAttempts += 1;
    console.log(`[sse] reconnecting in ${backoff}ms (attempt ${sseReconnectAttempts})`);
    await sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

async function connectAndConsume(): Promise<void> {
  if (!sessionCookie) {
    await login();
  }

  const buildHeaders = (): Record<string, string> => ({
    ...(state.lastEventId ? { 'Last-Event-ID': state.lastEventId } : {}),
    Cookie: sessionCookie ?? '',
  });

  let res = await fetch(`${APP_URL}/api/events/stream`, { headers: buildHeaders() });

  if (res.status === 401 || res.redirected) {
    await login();
    res = await fetch(`${APP_URL}/api/events/stream`, { headers: buildHeaders() });
  }

  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: HTTP ${res.status}`);
  }

  sseConnected = true;
  sseReconnectAttempts = 0;
  console.log('[sse] connected' + (state.lastEventId ? ` (resuming from ${state.lastEventId})` : ' (fresh)'));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        handleSseFrame(frame);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }

  // The server closed the connection — let the outer loop reconnect.
  throw new Error('SSE stream ended');
}

function handleSseFrame(frame: string): void {
  let id: string | null = null;
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue; // comment / keep-alive ping
    if (line.startsWith('id: ')) id = line.slice(4);
    else if (line.startsWith('event: ')) eventName = line.slice(7);
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
  }

  if (id) persistState(id);
  if (dataLines.length === 0 || eventName !== 'task_event') return;

  let data: unknown;
  try {
    data = JSON.parse(dataLines.join('\n'));
  } catch {
    console.warn('[sse] could not parse event data:', dataLines.join('\n'));
    return;
  }

  void routeTaskEvent(data as TaskEventPayload);
}

// ─── 4. Discord client + slash commands ────────────────────────────

const discordClient = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

const SLASH_COMMANDS = [
  new SlashCommandBuilder()
    .setName('vela')
    .setDescription('Vela orchestration status')
    .addSubcommand((sub) => sub.setName('status').setDescription('Active agents, task counts, SSE connection state'))
    .addSubcommand((sub) => sub.setName('tasks').setDescription('The 10 most recent non-terminal tasks'))
    .addSubcommand((sub) => sub.setName('budget').setDescription('Per-agent budget usage (USD and runs)'))
    .addSubcommand((sub) => sub.setName('agents').setDescription('Runtime agents, status, and model config')),
].map((c) => c.toJSON());

async function registerSlashCommands(): Promise<void> {
  if (!DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
    console.warn('[discord] skipping slash command registration (DISCORD_CLIENT_ID/DISCORD_GUILD_ID missing)');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID), { body: SLASH_COMMANDS });
  console.log(`[discord] slash commands registered for guild ${DISCORD_GUILD_ID}`);
}

// ─── 5. Outbound queue (per-channel rate limiting / coalescing) ────

const RATE_LIMIT_PER_MINUTE = 20;
const RATE_WINDOW_MS = 60_000;
const COALESCE_THRESHOLD = 8;
const DRAIN_TICK_MS = 1000;

interface ChannelQueueState {
  queue: Array<() => MessageCreateOptions>;
  sendTimestamps: number[];
}

const channelQueues = new Map<string, ChannelQueueState>();

function getQueueState(channelId: string): ChannelQueueState {
  let s = channelQueues.get(channelId);
  if (!s) {
    s = { queue: [], sendTimestamps: [] };
    channelQueues.set(channelId, s);
  }
  return s;
}

/** Queues a rate-limited, coalescible notification (used for #activity / #errors one-liners). */
function enqueueChannelMessage(channelId: string | undefined, build: () => MessageCreateOptions): void {
  if (!channelId) return;
  getQueueState(channelId).queue.push(build);
}

/** Sends immediately, bypassing the queue — reserved for actionable messages (approval requests). */
async function sendToChannel(channelId: string | undefined, payload: MessageCreateOptions): Promise<Message | null> {
  if (!channelId) return null;
  try {
    const channel = await discordClient.channels.fetch(channelId);
    if (!channel || !channel.isTextBased() || !('send' in channel)) {
      console.warn(`[discord] channel ${channelId} is not a sendable text channel`);
      return null;
    }
    return await channel.send(payload);
  } catch (err) {
    console.error(`[discord] failed to send to channel ${channelId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function startQueueDrain(): void {
  setInterval(() => {
    for (const [channelId, s] of channelQueues) {
      const cutoff = Date.now() - RATE_WINDOW_MS;
      s.sendTimestamps = s.sendTimestamps.filter((t) => t > cutoff);

      if (s.queue.length === 0) continue;
      if (s.sendTimestamps.length >= RATE_LIMIT_PER_MINUTE) continue; // capped — wait for a slot to free up

      if (s.queue.length > COALESCE_THRESHOLD) {
        const overflow = s.queue.length;
        s.queue = [];
        s.sendTimestamps.push(Date.now());
        const embed = new EmbedBuilder()
          .setDescription(`…and ${overflow} more events`)
          .setColor(0x99aab5)
          .setTimestamp(new Date());
        void sendToChannel(channelId, { embeds: [embed] });
        continue;
      }

      const build = s.queue.shift()!;
      s.sendTimestamps.push(Date.now());
      void sendToChannel(channelId, build());
    }
  }, DRAIN_TICK_MS);
}

// ─── 6. SSE → Discord routing ───────────────────────────────────────

function buildOneLineEmbed(opts: {
  title: string;
  description: string;
  taskId: string;
  color: number;
}): MessageCreateOptions {
  const embed = new EmbedBuilder()
    .setTitle(truncate(opts.title, 256))
    .setDescription(truncate(opts.description, 4000))
    .setColor(opts.color)
    .setFooter({ text: `task:${opts.taskId}` })
    .setTimestamp(new Date());
  return { embeds: [embed] };
}

async function routeTaskEvent(ev: TaskEventPayload): Promise<void> {
  const payload = (ev.payload ?? {}) as Record<string, unknown>;

  if (ev.eventType === 'approval_request') {
    await postApprovalRequest(ev, payload);
    return;
  }

  if (ev.eventType === 'status_change') {
    const to = String(payload.to ?? '');
    if (to === 'done' || to === 'review' || to === 'waiting_for_human') {
      const reason = String(payload.reason ?? 'no reason given');
      enqueueChannelMessage(DISCORD_CHANNEL_ACTIVITY, () =>
        buildOneLineEmbed({
          title: ev.taskTitle ?? 'Task update',
          description: `Task \`${shortId(ev.taskId)}\` → **${to}** — ${reason}`,
          taskId: ev.taskId,
          color: 0x5865f2,
        }),
      );
    }
    return;
  }

  if (
    ev.eventType === 'error' ||
    ev.eventType === 'budget_warning' ||
    ev.eventType === 'budget_exceeded' ||
    ev.eventType === 'loop_detected'
  ) {
    const summary = truncate(JSON.stringify(payload), 200);
    enqueueChannelMessage(DISCORD_CHANNEL_ERRORS, () =>
      buildOneLineEmbed({
        title: ev.eventType,
        description: `Task \`${shortId(ev.taskId)}\` — ${summary}`,
        taskId: ev.taskId,
        color: 0xed4245,
      }),
    );
  }
}

async function postApprovalRequest(ev: TaskEventPayload, payload: Record<string, unknown>): Promise<void> {
  const approvalId = String(payload.approval_id ?? '');
  if (!approvalId) {
    console.warn(`[approval] approval_request event ${ev.id} is missing payload.approval_id — skipping`);
    return;
  }

  const description = String(payload.description ?? 'No description provided.');
  const reviewUrl = `${APP_URL}/approvals/${approvalId}`;

  const embed = new EmbedBuilder()
    .setTitle('Approval requested')
    .setDescription(truncate(`${description}\n\n[Open the full review →](${reviewUrl})`, 4000))
    .addFields({ name: 'Task', value: `\`${ev.taskId}\`` })
    .setColor(0xfee75c)
    .setFooter({ text: `task:${ev.taskId}` })
    .setTimestamp(new Date());

  // Enrich from the approval row so the operator sees WHAT they are deciding:
  // the escalated judgment calls and the size of the proposed backlog.
  let backlogCount: number | null = null;
  try {
    const row = await db.query.approvals.findFirst({ where: eq(approvals.id, approvalId) });
    const p = row?.payload as {
      backlog?: unknown[];
      escalations?: Array<{ conflict?: string }>;
      prd_revision?: number;
      reviewed_revision?: number;
    } | null;
    if (p?.escalations?.length) {
      embed.addFields({
        name: `Escalated to you (${p.escalations.length})`,
        value: truncate(
          p.escalations
            .slice(0, 3)
            .map((e, i) => `${i + 1}. ${e.conflict ?? '(unstated conflict)'}`)
            .join('\n'),
          1024,
        ),
      });
    }
    if (p?.backlog) {
      backlogCount = p.backlog.length;
      embed.addFields({
        name: 'Proposed backlog',
        value: `${p.backlog.length} item(s)` +
          (p.prd_revision != null ? ` · PRD rev ${p.reviewed_revision ?? '?'} → ${p.prd_revision}` : ''),
        inline: true,
      });
    }
  } catch (err) {
    console.warn('[approval] could not enrich card from DB:', err instanceof Error ? err.message : err);
  }

  // Say what approving DOES: a backlog approval creates tasks, and the button
  // should admit it (operator feedback — two look-alike "Approve" sign-offs).
  const approveLabel =
    backlogCount != null ? `Approve backlog (creates ${backlogCount} tasks)` : 'Approve';
  const decideRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vela-approve:${approvalId}`).setLabel(approveLabel).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`vela-reject:${approvalId}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
  );
  const feedbackRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`vela-approve-fb:${approvalId}`).setLabel('Approve with feedback…').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`vela-reject-fb:${approvalId}`).setLabel('Reject with feedback…').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setURL(reviewUrl).setLabel('Review page').setStyle(ButtonStyle.Link),
  );

  // Approval requests are the actionable, rate-sensitive surface — always sent
  // immediately, never subject to the activity/errors coalescing queue.
  await sendToChannel(DISCORD_CHANNEL_APPROVALS, { embeds: [embed], components: [decideRow, feedbackRow] });
}

// ─── 7. Discord → Vela ──────────────────────────────────────────────

function isOperator(userId: string): boolean {
  return DISCORD_OPERATOR_IDS.has(userId);
}

async function reportUnauthorized(context: string, user: { id: string; tag: string }): Promise<void> {
  console.warn(`[auth] unauthorized attempt by ${user.tag} (${user.id}) — ${context}`);
  await sendToChannel(DISCORD_CHANNEL_ERRORS, {
    embeds: [
      new EmbedBuilder()
        .setDescription(`Unauthorized approval attempt by ${user.tag} (${user.id}) on ${context}`)
        .setColor(0xed4245)
        .setTimestamp(new Date()),
    ],
  });
}

const UNAUTHORIZED_MESSAGE = 'You are not authorized to act on Vela approvals.';

/** Shared decision executor for buttons and feedback modals. */
async function executeApprovalDecision(params: {
  decision: 'approve' | 'reject';
  approvalId: string;
  user: { id: string; username: string; tag: string };
  feedback?: string;
}): Promise<{ ok: boolean; detail: string }> {
  const notes = params.feedback
    ? `${truncate(params.feedback, 850)} — via Discord by ${params.user.username} (${params.user.id})`
    : `via Discord by ${params.user.username} (${params.user.id})`;

  let res: Response;
  try {
    res = await velaFetch(`/api/approvals/${params.approvalId}/${params.decision}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewerNotes: notes }),
    });
  } catch (err) {
    return { ok: false, detail: `Failed to reach Vela: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, detail: `Could not ${params.decision}: ${body.error ?? `HTTP ${res.status}`}` };
  }
  return { ok: true, detail: params.decision === 'approve' ? '✅ Approved' : '❌ Rejected' };
}

/** Edit the original card: append the outcome, drop the buttons. */
async function finalizeApprovalCard(
  message: ButtonInteraction['message'] | null,
  outcomeLine: string,
): Promise<void> {
  if (!message) return;
  try {
    const originalEmbed = message.embeds[0];
    const updatedEmbed = originalEmbed
      ? EmbedBuilder.from(originalEmbed).setDescription(
          truncate(`${originalEmbed.description ?? ''}\n\n${outcomeLine}`.trim(), 4000),
        )
      : new EmbedBuilder().setDescription(outcomeLine);
    await message.edit({ embeds: [updatedEmbed], components: [] });
  } catch (err) {
    console.error('[discord] failed to update approval message:', err);
  }
}

async function handleApprovalButton(interaction: ButtonInteraction): Promise<void> {
  const [action, approvalId] = interaction.customId.split(':');
  if (!approvalId) return;

  if (!isOperator(interaction.user.id)) {
    await reportUnauthorized(`approval ${approvalId}`, interaction.user);
    await interaction.reply({ content: UNAUTHORIZED_MESSAGE, ephemeral: true });
    return;
  }

  // Feedback variants open a text-input modal; showModal IS the 3s ack.
  if (action === 'vela-approve-fb' || action === 'vela-reject-fb') {
    const decision = action === 'vela-approve-fb' ? 'approve' : 'reject';
    const modal = new ModalBuilder()
      .setCustomId(`vela-modal:${decision}:${approvalId}`)
      .setTitle(decision === 'approve' ? 'Approve with feedback' : 'Reject with feedback')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId('feedback')
            .setLabel(
              decision === 'approve'
                ? 'Feedback (recorded on the approval)'
                : 'What should change? (routed to the synthesizer)',
            )
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(800),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action !== 'vela-approve' && action !== 'vela-reject') return;
  const decision = action === 'vela-approve' ? 'approve' : 'reject';

  // Ack within Discord's 3-second window BEFORE the Vela round trip —
  // interaction.update() after a slow POST is why earlier cards kept their
  // buttons after a decision.
  await interaction.deferUpdate();

  const result = await executeApprovalDecision({
    decision,
    approvalId,
    user: interaction.user,
  });

  if (!result.ok) {
    await interaction.followUp({ content: result.detail, ephemeral: true });
    return;
  }

  const outcomeLine = `${result.detail} by ${interaction.user.tag}`;
  await finalizeApprovalCard(interaction.message, outcomeLine);
  await interaction.followUp({ content: `${outcomeLine}.`, ephemeral: true });
}

async function handleApprovalModal(interaction: ModalSubmitInteraction): Promise<void> {
  const [prefix, decision, approvalId] = interaction.customId.split(':');
  if (prefix !== 'vela-modal' || (decision !== 'approve' && decision !== 'reject') || !approvalId) return;

  if (!isOperator(interaction.user.id)) {
    await reportUnauthorized(`approval ${approvalId} (modal)`, interaction.user);
    await interaction.reply({ content: UNAUTHORIZED_MESSAGE, ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const feedback = interaction.fields.getTextInputValue('feedback');
  const result = await executeApprovalDecision({
    decision: decision as 'approve' | 'reject',
    approvalId,
    user: interaction.user,
    feedback,
  });

  if (!result.ok) {
    await interaction.editReply(result.detail);
    return;
  }

  const outcomeLine = `${result.detail} with feedback by ${interaction.user.tag}`;
  await finalizeApprovalCard(interaction.isFromMessage() ? interaction.message : null, outcomeLine);
  await interaction.editReply(`${outcomeLine}.`);
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== 'vela') return;

  if (!isOperator(interaction.user.id)) {
    await reportUnauthorized(`/vela ${interaction.options.getSubcommand()}`, interaction.user);
    await interaction.reply({ content: UNAUTHORIZED_MESSAGE, ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  try {
    let reply: string;
    if (sub === 'status') reply = await buildStatusReply();
    else if (sub === 'tasks') reply = await buildTasksReply();
    else if (sub === 'budget') reply = await buildBudgetReply();
    else if (sub === 'agents') reply = await buildAgentsReply();
    else reply = 'Unknown subcommand.';
    await interaction.editReply(truncate(reply, 2000));
  } catch (err) {
    await interaction.editReply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const NON_TERMINAL_STATUSES = ['backlog', 'open', 'in_progress', 'review', 'waiting_for_human', 'blocked'];

async function buildStatusReply(): Promise<string> {
  const [activeAgents, allTasks] = await Promise.all([
    db.query.agents.findMany({ where: eq(agents.status, 'active'), columns: { id: true } }),
    db.query.tasks.findMany({ columns: { status: true } }),
  ]);

  const counts = new Map<string, number>();
  for (const t of allTasks) counts.set(t.status, (counts.get(t.status) ?? 0) + 1);

  const countLines =
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([status, n]) => `  ${status}: ${n}`)
      .join('\n') || '  (no tasks)';

  const sseState = sseConnected ? 'connected' : `disconnected (reconnect attempt ${sseReconnectAttempts})`;

  return [`**Active agents:** ${activeAgents.length}`, '**Tasks by status:**', countLines, `**SSE:** ${sseState}`].join(
    '\n',
  );
}

async function buildTasksReply(): Promise<string> {
  const rows = await db.query.tasks.findMany({
    where: inArray(tasks.status, NON_TERMINAL_STATUSES),
    orderBy: (t, { desc }) => [desc(t.createdAt)],
    limit: 10,
    with: { assignedAgent: { columns: { name: true } } },
  });

  if (rows.length === 0) return 'No non-terminal tasks.';

  return rows
    .map((t) => `\`${shortId(t.id)}\` **${t.title}** — ${t.status} (${t.assignedAgent?.name ?? 'unassigned'})`)
    .join('\n');
}

async function buildBudgetReply(): Promise<string> {
  const runtimeAgents = await db.query.agents.findMany({
    where: eq(agents.agentKind, 'runtime'),
    orderBy: (a, { asc }) => [asc(a.name)],
  });

  if (runtimeAgents.length === 0) return 'No runtime agents found.';

  return runtimeAgents
    .map((a) => {
      const usd = `$${a.budgetUsedUsd}/${a.budgetMonthlyUsd ?? '∞'}`;
      const runs = `${a.budgetUsedRuns}/${a.budgetMonthlyRuns ?? '∞'} runs`;
      return `**${a.name}** — ${a.status} — ${usd} — ${runs}`;
    })
    .join('\n');
}

async function buildAgentsReply(): Promise<string> {
  const runtimeAgents = await db.query.agents.findMany({
    where: eq(agents.agentKind, 'runtime'),
    orderBy: (a, { asc }) => [asc(a.name)],
    with: { modelConfig: { columns: { name: true } } },
  });

  if (runtimeAgents.length === 0) return 'No runtime agents found.';

  return runtimeAgents
    .map((a) => `**${a.name}** — ${a.status} — ${a.modelConfig?.name ?? 'no model configured'}`)
    .join('\n');
}

function extractTaskId(message: Message): string | null {
  for (const embed of message.embeds) {
    const match = (embed.footer?.text ?? '').match(UUID_PATTERN);
    if (match) return match[0];
  }
  const contentMatch = message.content.match(UUID_PATTERN);
  return contentMatch ? contentMatch[0] : null;
}

async function handleMessageReply(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.reference?.messageId) return;
  if (message.channelId !== DISCORD_CHANNEL_APPROVALS && message.channelId !== DISCORD_CHANNEL_ACTIVITY) return;

  const referenced = await message.fetchReference().catch(() => null);
  if (!referenced || referenced.author.id !== discordClient.user?.id) return;

  const taskId = extractTaskId(referenced);
  if (!taskId) return;

  // This bot serves a single-operator system — comments written back onto a
  // task go through the same allowlist as approvals rather than being open
  // to anyone who can see the channel.
  if (!isOperator(message.author.id)) {
    await reportUnauthorized(`reply forwarding on task ${taskId}`, {
      id: message.author.id,
      tag: message.author.tag,
    });
    await message.react('⚠️').catch(() => {});
    return;
  }

  try {
    const res = await velaFetch(`/api/tasks/${taskId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message.content, author: `${message.author.tag} via Discord` }),
    });

    if (res.status === 404) {
      console.warn(`[messages] POST /api/tasks/${taskId}/messages 404'd — route or task missing`);
      await message.react('⚠️').catch(() => {});
      return;
    }
    if (!res.ok) {
      console.warn(`[messages] forwarding reply to task ${taskId} failed: HTTP ${res.status}`);
      await message.react('⚠️').catch(() => {});
      return;
    }

    await message.react('✅').catch(() => {});
  } catch (err) {
    console.error(`[messages] error forwarding reply to task ${taskId}:`, err);
    await message.react('⚠️').catch(() => {});
  }
}

discordClient.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    try {
      if (interaction.isButton()) {
        if (/^vela-(approve|reject)(-fb)?:/.test(interaction.customId)) {
          await handleApprovalButton(interaction);
        }
        return;
      }
      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('vela-modal:')) {
          await handleApprovalModal(interaction);
        }
        return;
      }
      if (interaction.isChatInputCommand()) {
        await handleSlashCommand(interaction);
      }
    } catch (err) {
      console.error('[discord] interaction handler error:', err);
    }
  })();
});

discordClient.on(Events.MessageCreate, (message) => {
  void handleMessageReply(message).catch((err) => console.error('[discord] messageCreate handler error:', err));
});

// ─── 8. Bootstrap + graceful shutdown ───────────────────────────────

async function main(): Promise<void> {
  await loadState();

  discordClient.once(Events.ClientReady, (readyClient) => {
    console.log(`[discord] logged in as ${readyClient.user.tag}`);
    void registerSlashCommands().catch((err) => console.error('[discord] slash command registration failed:', err));
    startQueueDrain();
    void runSseLoop();
  });

  await discordClient.login(DISCORD_BOT_TOKEN);
}

let shuttingDownPromise: Promise<void> | null = null;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDownPromise) return shuttingDownPromise;
  shuttingDownPromise = (async () => {
    console.log(`[bot] received ${signal}, shutting down...`);
    shuttingDown = true;
    await flushState();
    discordClient.destroy();
  })();
  return shuttingDownPromise;
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(0));
});

// Test seam: tests import the real handlers and drive them with synthetic
// interactions; VELA_DISCORD_BOT_NO_START=1 suppresses the gateway startup.
export { handleApprovalButton, isOperator, velaFetch, login as velaLogin };

if (process.env.VELA_DISCORD_BOT_NO_START !== '1') {
  main().catch((err) => {
    console.error('[bot] fatal startup error:', err);
    process.exit(1);
  });
}
