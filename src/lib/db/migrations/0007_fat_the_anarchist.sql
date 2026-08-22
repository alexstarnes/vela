ALTER TABLE "agents" ADD COLUMN "budget_monthly_runs" integer;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "budget_used_runs" integer DEFAULT 0 NOT NULL;