-- Rolling-week log voor automatische assistent-outreach (max 3 profielen/week).
alter table users add column if not exists engagement_outbound_log jsonb;
