CREATE TABLE "github_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"github_user_id" text NOT NULL,
	"login" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"access_token_encrypted" text NOT NULL,
	"refresh_token_encrypted" text,
	"token_type" text,
	"scope" text,
	"token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "connection_status" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "helper_workspace_id" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "github_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_validated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_github_connections_user" ON "github_connections" USING btree ("github_user_id");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_github_connection_id_github_connections_id_fk" FOREIGN KEY ("github_connection_id") REFERENCES "public"."github_connections"("id") ON DELETE no action ON UPDATE no action;