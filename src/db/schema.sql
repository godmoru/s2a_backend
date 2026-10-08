CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(16) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  participant_id VARCHAR(32) UNIQUE,
  email_verified_at TIMESTAMPTZ,
  email_verification_method VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'user';
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'admin'));
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS participant_id VARCHAR(32);
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verification_method VARCHAR(16);

UPDATE users
   SET participant_id = 'S2A-NG-' || LPAD(id::text, GREATEST(6, LENGTH(id::text)), '0')
 WHERE participant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_participant_id_idx
  ON users(participant_id);

CREATE OR REPLACE FUNCTION assign_s2a_participant_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.participant_id IS NULL THEN
    NEW.participant_id := 'S2A-NG-' || LPAD(NEW.id::text, GREATEST(6, LENGTH(NEW.id::text)), '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_assign_participant_id ON users;
CREATE TRIGGER users_assign_participant_id
  BEFORE INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION assign_s2a_participant_id();

CREATE TABLE IF NOT EXISTS quizzes (
  id BIGSERIAL PRIMARY KEY,
  seed_key VARCHAR(100),
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS seed_key VARCHAR(100);

CREATE TABLE IF NOT EXISTS questions (
  id BIGSERIAL PRIMARY KEY,
  quiz_id BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  prompt TEXT NOT NULL,
  options JSONB NOT NULL,
  correct_option INTEGER NOT NULL CHECK (correct_option >= 0),
  points INTEGER NOT NULL DEFAULT 1000 CHECK (points > 0),
  time_limit_seconds INTEGER NOT NULL DEFAULT 20 CHECK (time_limit_seconds > 0),
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id BIGINT NOT NULL REFERENCES quizzes(id),
  host_user_id BIGINT NOT NULL REFERENCES users(id),
  status VARCHAR(16) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'lobby', 'active', 'completed')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 1 AND 1440),
  max_participants INTEGER NOT NULL DEFAULT 80 CHECK (max_participants BETWEEN 1 AND 320),
  expected_participants INTEGER NOT NULL DEFAULT 80,
  current_question_index INTEGER NOT NULL DEFAULT -1,
  question_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS expected_participants INTEGER;
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS max_participants INTEGER NOT NULL DEFAULT 80;
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS seed_key VARCHAR(100);
UPDATE matches
   SET expected_participants = LEAST(max_participants, 80)
 WHERE expected_participants IS NULL;
ALTER TABLE matches
  ALTER COLUMN expected_participants SET DEFAULT 80;
ALTER TABLE matches
  ALTER COLUMN expected_participants SET NOT NULL;
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_status_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_status_check
  CHECK (status IN ('scheduled', 'lobby', 'active', 'completed'));
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_max_participants_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_max_participants_check
  CHECK (max_participants BETWEEN 1 AND 320);
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_expected_participants_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_expected_participants_check
  CHECK (expected_participants BETWEEN 1 AND max_participants);
ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_duration_minutes_check;
ALTER TABLE matches
  ADD CONSTRAINT matches_duration_minutes_check
  CHECK (duration_minutes BETWEEN 1 AND 1440);
CREATE UNIQUE INDEX IF NOT EXISTS matches_seed_key_idx
  ON matches(seed_key) WHERE seed_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quizzes_seed_key_idx
  ON quizzes(seed_key) WHERE seed_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS match_players (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0),
  current_question_index INTEGER NOT NULL DEFAULT -1 CHECK (current_question_index >= -1),
  question_ends_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, user_id)
);

ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS current_question_index INTEGER NOT NULL DEFAULT -1;
ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS question_ends_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS answers (
  match_id UUID NOT NULL,
  user_id BIGINT NOT NULL,
  question_index INTEGER NOT NULL CHECK (question_index >= 0),
  selected_option INTEGER NOT NULL CHECK (selected_option >= 0),
  is_correct BOOLEAN NOT NULL,
  points_awarded INTEGER NOT NULL CHECK (points_awarded >= 0),
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, user_id, question_index),
  FOREIGN KEY (match_id, user_id)
    REFERENCES match_players(match_id, user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrity_flags (
  id BIGSERIAL PRIMARY KEY,
  participant_user_id BIGINT NOT NULL REFERENCES users(id),
  competition_id UUID REFERENCES matches(id) ON DELETE SET NULL,
  category VARCHAR(60) NOT NULL,
  details TEXT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE integrity_flags
  DROP CONSTRAINT IF EXISTS integrity_flags_status_check;
ALTER TABLE integrity_flags
  ADD CONSTRAINT integrity_flags_status_check
  CHECK (status IN ('open', 'reviewed', 'dismissed'));

CREATE INDEX IF NOT EXISTS match_players_user_score_idx
  ON match_players(user_id, score DESC);
CREATE INDEX IF NOT EXISTS matches_status_deadline_idx
  ON matches(status, question_ends_at);
CREATE INDEX IF NOT EXISTS matches_start_schedule_idx
  ON matches(status, starts_at);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx
  ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_entity_idx
  ON audit_events(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS integrity_flags_status_created_at_idx
  ON integrity_flags(status, created_at DESC);
CREATE INDEX IF NOT EXISTS integrity_flags_participant_idx
  ON integrity_flags(participant_user_id, created_at DESC);
