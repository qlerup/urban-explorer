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
