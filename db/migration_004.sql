-- Bruger-til-bruger-deling af kategorier ("mapper").
-- can_edit = FALSE: modtageren kan kun se pins i kategorien.
-- can_edit = TRUE: modtageren kan også tilføje og redigere pins i kategorien.
CREATE TABLE IF NOT EXISTS category_shares (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id    UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category_id, shared_with_id)
);

CREATE INDEX IF NOT EXISTS idx_category_shares_shared_with ON category_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_category_shares_category_id ON category_shares(category_id);
