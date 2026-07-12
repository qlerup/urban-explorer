ALTER TABLE pins ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '📍';

-- Ikoner flyttes fra kategori til pin. Kør kun engang: hvis categories.icon stadig
-- findes, kopiér den ind på hver pin (så eksisterende markører beholder deres udseende)
-- og drop derefter kolonnen. Gør migrationen sikker at genafspille ved fremtidige deploys.
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
