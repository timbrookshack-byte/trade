-- Extra trade-application questions shown to the team when approving.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS how_heard TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS social_media TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS current_projects TEXT NOT NULL DEFAULT '';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS additional_info TEXT NOT NULL DEFAULT '';
