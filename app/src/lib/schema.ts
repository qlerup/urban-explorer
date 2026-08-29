import pool from './db'

// Idempotent udgave af db/init.sql + migrationer. init.sql kører kun når
// Postgres-volumen er helt frisk, og migrationsfilerne kræver manuel kørsel.
// Ved FjordHub-installation og -opdatering er der ingen af delene, så skemaet
// sikres her ved hver serverstart i stedet.
const SCHEMA_SQL = `
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

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fjordhub_migrated_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fjordhub_user_id BIGINT UNIQUE;

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

ALTER TABLE pins ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE pins ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '📍';

-- Ikoner flyttedes fra kategori til pin (migration_003). Kopiér gamle værdier
-- med over og drop kolonnen, hvis den stadig findes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'categories' AND column_name = 'icon'
  ) THEN
    UPDATE pins p SET icon = c.icon
    FROM categories c
    WHERE p.category_id = c.id;

    ALTER TABLE categories DROP COLUMN icon;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pins_user_id ON pins(user_id);
CREATE INDEX IF NOT EXISTS idx_pins_category_id ON pins(category_id);
CREATE INDEX IF NOT EXISTS idx_pins_location ON pins USING GIST(location);
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);

CREATE TABLE IF NOT EXISTS pin_categories (
    pin_id       UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    category_id  UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (pin_id, category_id)
);

INSERT INTO pin_categories (pin_id, category_id, position)
SELECT id, category_id, 0
FROM pins
WHERE category_id IS NOT NULL
ON CONFLICT (pin_id, category_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_pin_categories_category_id ON pin_categories(category_id);

CREATE TABLE IF NOT EXISTS pin_images (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id        UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    filename      TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    size_bytes    BIGINT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pin_images_pin_id ON pin_images(pin_id);
ALTER TABLE pin_images ALTER COLUMN size_bytes TYPE BIGINT;

CREATE TABLE IF NOT EXISTS pin_routes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pin_id          UUID NOT NULL REFERENCES pins(id) ON DELETE CASCADE,
    name            TEXT NOT NULL DEFAULT '',
    points          JSONB NOT NULL,
    distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE pin_routes DROP CONSTRAINT IF EXISTS pin_routes_pin_id_key;
ALTER TABLE pin_routes ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
ALTER TABLE pin_routes ADD COLUMN IF NOT EXISTS distance_meters DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_pin_routes_pin_id ON pin_routes(pin_id);

CREATE TABLE IF NOT EXISTS app_settings (
    id            SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    maptiler_key  TEXT,
    smtp_user     TEXT,
    smtp_password TEXT,
    smtp_host     TEXT,
    smtp_port     INTEGER,
    map_provider  TEXT NOT NULL DEFAULT 'esri',
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS smtp_user TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS smtp_password TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS smtp_host TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS smtp_port INTEGER;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS map_provider TEXT NOT NULL DEFAULT 'esri';

CREATE TABLE IF NOT EXISTS password_reset_challenges (
    id               UUID PRIMARY KEY,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash        TEXT NOT NULL,
    reset_token_hash TEXT,
    attempts         SMALLINT NOT NULL DEFAULT 0,
    expires_at       TIMESTAMPTZ NOT NULL,
    verified_at      TIMESTAMPTZ,
    used_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_user_created
ON password_reset_challenges(user_id, created_at DESC);

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

-- Deling af ejerens pins UDEN kategori til en anden bruger. Kategoriserede
-- pins deles via category_shares; tilsammen udgør de "del med bruger".
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

-- Direkte deling af enkelte pins, uafhængigt af kategori-deling.
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

-- Pins parset fra en KMZ/KML-import, som endnu ikke er gennemgået og gemt som
-- en rigtig pin. Ligger i databasen (i stedet for kun i browserens hukommelse),
-- så man kan gennemgå nogle stykker i dag og resten en anden dag.
CREATE TABLE IF NOT EXISTS import_candidates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_import_candidates_user_id ON import_candidates(user_id);
`

export async function ensureSchema(): Promise<void> {
  try {
    await pool.query(SCHEMA_SQL)
    console.log('[schema] Databaseskema sikret')
  } catch (error) {
    console.error('[schema] Kunne ikke sikre databaseskema:', error)
  }
}
