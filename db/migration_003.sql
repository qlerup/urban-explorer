CREATE TABLE IF NOT EXISTS grid_cells (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    row        INTEGER NOT NULL,
    col        INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, row, col)
);

CREATE INDEX IF NOT EXISTS idx_grid_cells_user_id ON grid_cells(user_id);
