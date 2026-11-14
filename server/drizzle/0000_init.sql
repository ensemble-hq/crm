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
	"active" boolean DEFAULT true NOT NULL,
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
CREATE INDEX "activities_record_idx" ON "activities" USING btree ("tenant_id","record_id","occurred_at");
--> statement-breakpoint
CREATE INDEX "objects_tenant_id_idx" ON "objects" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "people_tenant_id_idx" ON "people" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "records_object_idx" ON "records" USING btree ("tenant_id","object_id","created_at");
