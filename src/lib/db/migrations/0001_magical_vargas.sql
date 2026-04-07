CREATE TABLE "agent_model_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"model_config_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "domain" text DEFAULT 'meta' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_model_access" ADD CONSTRAINT "agent_model_access_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_model_access" ADD CONSTRAINT "agent_model_access_model_config_id_model_configs_id_fk" FOREIGN KEY ("model_config_id") REFERENCES "public"."model_configs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_agent_model" ON "agent_model_access" USING btree ("agent_id","model_config_id");--> statement-breakpoint
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_model_id_unique" UNIQUE("model_id");