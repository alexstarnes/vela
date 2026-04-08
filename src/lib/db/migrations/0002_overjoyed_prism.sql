ALTER TABLE "projects" ADD COLUMN "source_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "workspace_path" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repository_url" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repository_owner" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "repository_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "default_branch" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "source_label" text;