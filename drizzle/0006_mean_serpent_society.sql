CREATE TABLE "score_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"score_awarded" integer NOT NULL,
	"score_source" "score_source" NOT NULL,
	"score_rationale" text,
	"scored_by" uuid,
	"scored_at" timestamp with time zone,
	"replaced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_by" uuid
);
--> statement-breakpoint
ALTER TABLE "answers" ADD COLUMN "score_rationale" text;--> statement-breakpoint
ALTER TABLE "score_history" ADD CONSTRAINT "score_history_answer_id_answers_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."answers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "score_history_answer_idx" ON "score_history" USING btree ("answer_id","replaced_at");