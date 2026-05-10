CREATE TYPE "public"."assessment_visibility" AS ENUM('listed', 'unlisted');--> statement-breakpoint
ALTER TABLE "assessments" ADD COLUMN "visibility" "assessment_visibility" DEFAULT 'listed' NOT NULL;