CREATE TYPE "public"."assessment_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."question_type" AS ENUM('mcq', 'true_false', 'open', 'voice', 'file', 'formula');--> statement-breakpoint
CREATE TYPE "public"."response_status" AS ENUM('in_progress', 'submitted', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."role_type" AS ENUM('tech', 'bd');--> statement-breakpoint
CREATE TYPE "public"."timeout_action" AS ENUM('auto_submit', 'skip', 'mark_incorrect');--> statement-breakpoint
CREATE TABLE "answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"response_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_spent_seconds" integer DEFAULT 0 NOT NULL,
	"timed_out" boolean DEFAULT false NOT NULL,
	"score_awarded" integer DEFAULT 0 NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"role_type" "role_type" NOT NULL,
	"status" "assessment_status" DEFAULT 'draft' NOT NULL,
	"pass_threshold" integer DEFAULT 70 NOT NULL,
	"intro_text" text DEFAULT '' NOT NULL,
	"outro_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessments_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "branching_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"from_question_id" uuid NOT NULL,
	"condition" jsonb NOT NULL,
	"action" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"type" "question_type" DEFAULT 'mcq' NOT NULL,
	"question_text" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"correct_answer" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"points" integer DEFAULT 1 NOT NULL,
	"negative_points" integer DEFAULT 0 NOT NULL,
	"timer_enabled" boolean DEFAULT false NOT NULL,
	"time_limit_seconds" integer,
	"timeout_action" timeout_action DEFAULT 'auto_submit' NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"section" text
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assessment_id" uuid NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_email" text NOT NULL,
	"candidate_phone" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"total_score" integer,
	"max_possible_score" integer DEFAULT 0 NOT NULL,
	"status" "response_status" DEFAULT 'in_progress' NOT NULL,
	"pass" boolean,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_response_id_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answers" ADD CONSTRAINT "answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branching_rules" ADD CONSTRAINT "branching_rules_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branching_rules" ADD CONSTRAINT "branching_rules_from_question_id_questions_id_fk" FOREIGN KEY ("from_question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_assessment_id_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "answers_response_question_idx" ON "answers" USING btree ("response_id","question_id");--> statement-breakpoint
CREATE INDEX "branching_rules_from_question_idx" ON "branching_rules" USING btree ("from_question_id");--> statement-breakpoint
CREATE INDEX "questions_assessment_id_idx" ON "questions" USING btree ("assessment_id");--> statement-breakpoint
CREATE INDEX "responses_assessment_id_idx" ON "responses" USING btree ("assessment_id");