ALTER TABLE "agents" ADD COLUMN "agent_kind" text DEFAULT 'runtime' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "failure_count" integer DEFAULT 0 NOT NULL;
