-- Featured categories: double-width tiles shown first on the home page.
ALTER TABLE category_settings ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE;
