CREATE TABLE "search_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferred" text DEFAULT 'auto' NOT NULL,
	"tavily_api_key_cipher" text,
	"tavily_api_key_last4" text,
	"searxng_url" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_settings" ADD CONSTRAINT "search_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;