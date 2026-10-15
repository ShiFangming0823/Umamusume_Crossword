-- Independent random-puzzle totals; legacy tables and their history remain untouched.
CREATE TABLE IF NOT EXISTS random_game_runs (
 run_id TEXT PRIMARY KEY,
 category TEXT NOT NULL CHECK(category IN ('beginner','advanced','epithets','cinderella')),
 board_size TEXT NOT NULL CHECK(board_size IN ('small','large')),
 solution_hash TEXT NOT NULL,
 started_at INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','solved','revealed')),
 elapsed_ms INTEGER,
 finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS random_runs_scope ON random_game_runs(category,board_size,started_at);
CREATE TABLE IF NOT EXISTS category_stats (
 category TEXT NOT NULL,
 board_size TEXT NOT NULL,
 starts INTEGER NOT NULL DEFAULT 0,
 solved INTEGER NOT NULL DEFAULT 0,
 elapsed_total_ms INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(category,board_size)
);
CREATE TRIGGER IF NOT EXISTS random_run_started AFTER INSERT ON random_game_runs
BEGIN
 INSERT INTO category_stats(category,board_size,starts) VALUES(NEW.category,NEW.board_size,1)
 ON CONFLICT(category,board_size) DO UPDATE SET starts=starts+1;
END;
CREATE TRIGGER IF NOT EXISTS random_run_solved AFTER UPDATE OF status ON random_game_runs
WHEN OLD.status='active' AND NEW.status='solved'
BEGIN
 UPDATE category_stats SET solved=solved+1,elapsed_total_ms=elapsed_total_ms+NEW.elapsed_ms
 WHERE category=NEW.category AND board_size=NEW.board_size;
END;
