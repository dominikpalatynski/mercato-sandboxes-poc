CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"coder_user_id" uuid,
	"coder_username" text,
	"coder_temp_password" text,
	"first_name" text,
	"last_name" text,
	"company_name" text,
	"accepted_terms_at" timestamp with time zone,
	"openmercato_customer_entity_id" uuid,
	"openmercato_customer_person_id" uuid,
	"gitea_org_name" text,
	"github_installation_id" text,
	"github_login" text,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "sandboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"preset_id" text DEFAULT 'crm' NOT NULL,
	"coder_workspace_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_message" text,
	"vscode_url" text,
	"terminal_url" text,
	"app_url" text,
	"splash_url" text,
	"repo_origin" text DEFAULT 'gitea' NOT NULL,
	"gitea_repo_name" text,
	"gitea_clone_url" text,
	"github_repo_full_name" text,
	"github_clone_url" text,
	"workspace_creds_secret_name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"order_id" uuid,
	"event_type" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "billing_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "billing_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"status" text NOT NULL,
	"plan_type" text NOT NULL,
	"amount_pln" numeric(12, 2) NOT NULL,
	"credits_usd" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"paid_at" timestamp with time zone,
	CONSTRAINT "billing_orders_provider_order_id_unique" UNIQUE("provider_order_id")
);
--> statement-breakpoint
CREATE TABLE "llm_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"openrouter_key_hash" text NOT NULL,
	"openrouter_key_label" text NOT NULL,
	"status" text NOT NULL,
	"coder_secret_sync_state" text NOT NULL,
	"limit_usd" numeric(12, 2) NOT NULL,
	"limit_reset" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "llm_accounts_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "llm_accounts_openrouter_key_hash_unique" UNIQUE("openrouter_key_hash")
);
--> statement-breakpoint
CREATE TABLE "llm_usage_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"llm_account_id" uuid NOT NULL,
	"usage_total_usd" numeric(12, 2) NOT NULL,
	"usage_monthly_usd" numeric(12, 2) NOT NULL,
	"limit_remaining_usd" numeric(12, 2) NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "sandboxes" ADD CONSTRAINT "sandboxes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_order_id_billing_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."billing_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_orders" ADD CONSTRAINT "billing_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_accounts" ADD CONSTRAINT "llm_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_usage_snapshots" ADD CONSTRAINT "llm_usage_snapshots_llm_account_id_llm_accounts_id_fk" FOREIGN KEY ("llm_account_id") REFERENCES "public"."llm_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sandboxes_user_id_idx" ON "sandboxes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_events_order_id_created_at_idx" ON "billing_events" USING btree ("order_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "billing_orders_user_id_created_at_idx" ON "billing_orders" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "llm_accounts_status_user_id_idx" ON "llm_accounts" USING btree ("status","user_id");--> statement-breakpoint
CREATE INDEX "llm_usage_snapshots_account_observed_at_idx" ON "llm_usage_snapshots" USING btree ("llm_account_id","observed_at" DESC NULLS LAST);