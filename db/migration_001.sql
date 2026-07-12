ALTER TABLE pins
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS pin_routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id          UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    points          JSONB NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tidligere version tillod kun én rute pr. pin (UNIQUE pin_id) - fjernes så en pin kan have flere navngivne ruter.
ALTER TABLE pin_routes DROP CONSTRAINT IF EXISTS pin_routes_pin_id_key;
ALTER TABLE pin_routes ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE pin_routes ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pin_routes_pin_id ON pin_routes(pin_id);
