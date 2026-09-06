-- Projects can feature products ("shop the look" cards on the project page).
ALTER TABLE projects ADD COLUMN product_skus JSONB NOT NULL DEFAULT '[]';
