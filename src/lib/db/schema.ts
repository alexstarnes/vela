import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ─── projects ─────────────────────────────────────────────────────
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  goal: text('goal'),
  context: text('context'),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── model_configs ────────────────────────────────────────────────
export const modelConfigs = pgTable('model_configs', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  provider: text('provider').notNull(), // 'anthropic' | 'openai' | 'ollama'
  modelId: text('model_id').notNull().unique(),
  tier: text('tier').notNull(), // 'fast' | 'standard' | 'premium'
  isLocal: boolean('is_local').notNull().default(false),
  endpointUrl: text('endpoint_url'),
  inputCostPer1m: numeric('input_cost_per_1m', { precision: 10, scale: 4 }).notNull().default('0'),
  outputCostPer1m: numeric('output_cost_per_1m', { precision: 10, scale: 4 }).notNull().default('0'),
  maxContextTokens: integer('max_context_tokens').notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── agents ───────────────────────────────────────────────────────
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id),
  parentId: uuid('parent_id'), // self-ref
  name: text('name').notNull(),
  role: text('role').notNull(),
  domain: text('domain').notNull().default('meta'), // 'meta' | 'product' | 'architecture' | 'implementation' | 'quality' | 'operations'
  systemPrompt: text('system_prompt'),
  modelConfigId: uuid('model_config_id').references(() => modelConfigs.id),
  budgetMonthlyUsd: numeric('budget_monthly_usd', { precision: 10, scale: 2 }),
  budgetUsedUsd: numeric('budget_used_usd', { precision: 10, scale: 4 }).notNull().default('0'),
  budgetResetAt: timestamp('budget_reset_at', { withTimezone: true }),
  heartbeatCron: text('heartbeat_cron'),
  heartbeatEnabled: boolean('heartbeat_enabled').notNull().default(true),
  maxIterations: integer('max_iterations').notNull().default(10),
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'budget_exceeded'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_agents_budget').on(table.status, table.budgetUsedUsd),
]);

// ─── agent_model_access ──────────────────────────────────────────
export const agentModelAccess = pgTable('agent_model_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  modelConfigId: uuid('model_config_id').notNull().references(() => modelConfigs.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('uq_agent_model').on(table.agentId, table.modelConfigId),
]);

// ─── skills ───────────────────────────────────────────────────────
export const skills = pgTable('skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  scope: text('scope').notNull(), // 'global' | 'project'
  projectId: uuid('project_id').references(() => projects.id),
  contentMd: text('content_md'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─── tasks ────────────────────────────────────────────────────────
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').notNull().references(() => projects.id),
  parentTaskId: uuid('parent_task_id'), // self-ref
  assignedAgentId: uuid('assigned_agent_id').references(() => agents.id),
  createdByAgentId: uuid('created_by_agent_id').references(() => agents.id),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('backlog'),
  priority: text('priority').notNull().default('medium'), // 'low' | 'medium' | 'high' | 'urgent'
  lockedBy: uuid('locked_by').references(() => agents.id),
  lockedAt: timestamp('locked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_tasks_status_agent').on(table.status, table.assignedAgentId),
  index('idx_tasks_open_unlocked').on(table.status, table.projectId),
]);

// ─── task_events ──────────────────────────────────────────────────
export const taskEvents = pgTable('task_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  agentId: uuid('agent_id').references(() => agents.id),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload'),
  tokensUsed: integer('tokens_used'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_task_events_task').on(table.taskId, table.createdAt),
  index('idx_task_events_agent').on(table.agentId, table.createdAt),
]);

// ─── heartbeats ───────────────────────────────────────────────────
export const heartbeats = pgTable('heartbeats', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  tasksProcessed: integer('tasks_processed').notNull().default(0),
  tokensUsed: integer('tokens_used').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'failed' | 'timeout'
  error: text('error'),
}, (table) => [
  index('idx_heartbeats_agent').on(table.agentId, table.startedAt),
]);

// ─── approvals ────────────────────────────────────────────────────
export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  taskId: uuid('task_id').references(() => tasks.id),
  actionType: text('action_type').notNull(), // 'task_delegation' | 'budget_override' | 'agent_creation'
  description: text('description').notNull(),
  payload: jsonb('payload'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  reviewerNotes: text('reviewer_notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});

// ─── Relations ────────────────────────────────────────────────────

export const projectsRelations = relations(projects, ({ many }) => ({
  agents: many(agents),
  tasks: many(tasks),
  skills: many(skills),
}));

export const modelConfigsRelations = relations(modelConfigs, ({ many }) => ({
  agents: many(agents),
  agentAccess: many(agentModelAccess),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  project: one(projects, { fields: [agents.projectId], references: [projects.id] }),
  modelConfig: one(modelConfigs, { fields: [agents.modelConfigId], references: [modelConfigs.id] }),
  parent: one(agents, { fields: [agents.parentId], references: [agents.id], relationName: 'agentParent' }),
  children: many(agents, { relationName: 'agentParent' }),
  allowedModels: many(agentModelAccess),
  tasks: many(tasks, { relationName: 'assignedAgent' }),
  createdTasks: many(tasks, { relationName: 'createdByAgent' }),
  taskEvents: many(taskEvents),
  heartbeats: many(heartbeats),
}));

export const agentModelAccessRelations = relations(agentModelAccess, ({ one }) => ({
  agent: one(agents, { fields: [agentModelAccess.agentId], references: [agents.id] }),
  modelConfig: one(modelConfigs, { fields: [agentModelAccess.modelConfigId], references: [modelConfigs.id] }),
}));

export const skillsRelations = relations(skills, ({ one }) => ({
  project: one(projects, { fields: [skills.projectId], references: [projects.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  assignedAgent: one(agents, { fields: [tasks.assignedAgentId], references: [agents.id], relationName: 'assignedAgent' }),
  createdByAgent: one(agents, { fields: [tasks.createdByAgentId], references: [agents.id], relationName: 'createdByAgent' }),
  lockedByAgent: one(agents, { fields: [tasks.lockedBy], references: [agents.id], relationName: 'lockedByAgent' }),
  parentTask: one(tasks, { fields: [tasks.parentTaskId], references: [tasks.id], relationName: 'taskParent' }),
  subtasks: many(tasks, { relationName: 'taskParent' }),
  events: many(taskEvents),
}));

export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
  task: one(tasks, { fields: [taskEvents.taskId], references: [tasks.id] }),
  agent: one(agents, { fields: [taskEvents.agentId], references: [agents.id] }),
}));

export const heartbeatsRelations = relations(heartbeats, ({ one }) => ({
  agent: one(agents, { fields: [heartbeats.agentId], references: [agents.id] }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  agent: one(agents, { fields: [approvals.agentId], references: [agents.id] }),
  task: one(tasks, { fields: [approvals.taskId], references: [tasks.id] }),
}));

// ─── Inferred types ───────────────────────────────────────────────
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type Skill = typeof skills.$inferSelect;
export type NewSkill = typeof skills.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;

export type ModelConfig = typeof modelConfigs.$inferSelect;
export type NewModelConfig = typeof modelConfigs.$inferInsert;

export type Heartbeat = typeof heartbeats.$inferSelect;
export type NewHeartbeat = typeof heartbeats.$inferInsert;

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;

export type AgentModelAccess = typeof agentModelAccess.$inferSelect;
export type NewAgentModelAccess = typeof agentModelAccess.$inferInsert;
