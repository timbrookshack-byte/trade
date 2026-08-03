-- Sync auto-deactivation: 360 products with zero Wakerley stock and nothing
-- incoming are pulled from the storefront; the flag records that the SYNC did
-- it (so it may auto-reactivate when stock returns — manual deactivations are
-- never touched).
ALTER TABLE products ADD COLUMN auto_deactivated BOOLEAN NOT NULL DEFAULT FALSE;
