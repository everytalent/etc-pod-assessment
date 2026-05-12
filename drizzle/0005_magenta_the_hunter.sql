CREATE TYPE "public"."ai_consensus" AS ENUM('pending', 'gemini_only', 'agree', 'override');--> statement-breakpoint
CREATE TYPE "public"."ai_score_provider" AS ENUM('gemini', 'kimi');--> statement-breakpoint
CREATE TYPE "public"."score_source" AS ENUM('manual', 'ai_gemini', 'ai_kimi');--> statement-breakpoint
CREATE TABLE "ai_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"provider" "ai_score_provider" NOT NULL,
	"score" integer NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"hits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"misses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"red_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_scores_answer_provider_uniq" UNIQUE("answer_id","provider")
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled_for_roles" text[] DEFAULT '{}' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "transcript" text;--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "score_source" "score_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "scoring_rubric" text;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "ai_consensus" "ai_consensus" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "responses" ADD COLUMN "ai_pipeline_ran_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_scores" ADD CONSTRAINT "ai_scores_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_scores_answer_idx" ON "ai_scores" USING btree ("answer_id");