CREATE TABLE IF NOT EXISTS pin_shares (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id         UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    shared_with_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    can_edit       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (pin_id, shared_with_id)
);

CREATE INDEX IF NOT EXISTS idx_pin_shares_shared_with ON pin_shares(shared_with_id);
CREATE INDEX IF NOT EXISTS idx_pin_shares_pin_id ON pin_shares(pin_id);
