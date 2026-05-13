CREATE TYPE "public"."integrity_level" AS ENUM('low', 'mid', 'high');--> statement-breakpoint
CREATE TYPE "public"."integrity_source" AS ENUM('manual', 'ai_kimi', 'ai_gemini');--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "integrity_level" "integrity_level";--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "integrity_level_source" "integrity_source";--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "integrity_level_set_by" uuid;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "integrity_level_set_at" timestamp with time zone;