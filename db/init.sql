CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    first_name      TEXT NOT NULL,
    email           TEXT NOT NULL,
    email_hash      TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INT NOT NULL DEFAULT 0,
    locked_until    TIMESTAMPTZ,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT NOT NULL DEFAULT '#e08a3c',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS pins (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    location    GEOGRAPHY(POINT, 4326) NOT NULL,
    rating      SMALLINT NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 3),
    status      TEXT NOT NULL DEFAULT 'vil_se' CHECK (status IN ('vil_se','har_set','hold_oeje','doedt_spot')),
    icon        TEXT NOT NULL DEFAULT '📍',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pins_user_id ON pins(user_id);
CREATE INDEX IF NOT EXISTS idx_pins_category_id ON pins(category_id);
CREATE INDEX IF NOT EXISTS idx_pins_location ON pins USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

CREATE TABLE IF NOT EXISTS pin_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id        UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size_bytes    INT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_images_pin_id ON pin_images(pin_id);

CREATE TABLE IF NOT EXISTS pin_routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id          UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    points          JSONB NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_routes_pin_id ON pin_routes(pin_id);

CREATE TABLE IF NOT EXISTS app_settings (
    id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    maptiler_key  TEXT,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_links (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT UNIQUE NOT NULL,
    label       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_links_user_id ON share_links(user_id);

CREATE TABLE IF NOT EXISTS share_link_pins (
    share_link_id UUID NOT NULL REFERENCES share_links(id) ON DELETE CASCADE,
    pin_id        UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    PRIMARY KEY (share_link_id, pin_id)
);

CREATE INDEX IF NOT EXISTS idx_share_link_pins_share_link_id ON share_link_pins(share_link_id);
CREATE INDEX IF NOT EXISTS idx_share_link_pins_pin_id ON share_link_pins(pin_id);

CREATE TABLE IF NOT EXISTS grid_cells (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    row        INTEGER NOT NULL,
    col        INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, row, col)
);

CREATE INDEX IF NOT EXISTS idx_grid_cells_user_id ON grid_cells(user_id);

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
