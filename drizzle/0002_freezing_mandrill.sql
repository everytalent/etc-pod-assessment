ALTER TABLE "answers" ADD COLUMN "text_response" text;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "audio_path" text;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "audio_duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "scored_by" uuid;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "scored_at" timestamp with time zone;