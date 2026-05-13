ALTER TABLE "responses" ADD COLUMN "integrity_deduction_pct" integer;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "integrity_deduction_rationale" text;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "integrity_deduction_set_by" uuid;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "integrity_deduction_set_at" timestamp with time zone;