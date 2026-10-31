-- A soft-deleted tax must not block re-using its name, and "gst" / "GST" are the same name:
-- the same rule products and plans already follow (see the constraints migration).
DROP INDEX "taxes_name_key";
CREATE UNIQUE INDEX "taxes_name_live_uq" ON "taxes" (lower("name")) WHERE "deletedAt" IS NULL;
