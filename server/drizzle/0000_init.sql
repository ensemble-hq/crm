CREATE TABLE "mariachi_event_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"envelope" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "activities" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"record_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"actor_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"record_id" text,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "objects" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role_id" text NOT NULL,
	"team_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"viewing_as" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "records" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"object_id" text NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);

--> statement-breakpoint
CREATE TABLE "roles" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"settings" jsonb NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "teams" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"record_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text NOT NULL,
	"steps" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"settings" jsonb NOT NULL,
	"turn" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

--> statement-breakpoint
CREATE INDEX "mariachi_event_outbox_pending_idx" ON "mariachi_event_outbox" USING btree ("available_at") WHERE published_at IS NULL;
--> statement-breakpoint
CREATE INDEX "mariachi_event_outbox_published_idx" ON "mariachi_event_outbox" USING btree ("published_at") WHERE published_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "activities_record_idx" ON "activities" USING btree ("tenant_id","record_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at");
--> statement-breakpoint
CREATE INDEX "objects_tenant_id_idx" ON "objects" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "people_tenant_id_idx" ON "people" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "records_object_idx" ON "records" USING btree ("tenant_id","object_id","created_at");
--> statement-breakpoint
CREATE INDEX "roles_tenant_id_idx" ON "roles" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "teams_tenant_id_idx" ON "teams" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_event_idx" ON "workflow_runs" USING btree ("workflow_id","event_id");
--> statement-breakpoint
CREATE INDEX "workflow_runs_recent_idx" ON "workflow_runs" USING btree ("tenant_id","workflow_id","started_at");
--> statement-breakpoint
CREATE INDEX "workflows_tenant_id_idx" ON "workflows" USING btree ("tenant_id");
