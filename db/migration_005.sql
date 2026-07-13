-- Bruger-til-bruger-deling af pins uden kategori.
-- Kategoriserede pins deles gennem den eksisterende category_shares-tabel.
CREATE TABLE IF NOT EXISTS uncategorized_pin_shares (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (owner_id, shared_with_id)
);

CREATE INDEX IF NOT EXISTS idx_uncat_pin_shares_shared_with ON uncategorized_pin_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_uncat_pin_shares_owner ON uncategorized_pin_shares(owner_id);
