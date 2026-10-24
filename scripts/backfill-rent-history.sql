-- One-time fix for a unit whose rent was changed (lease renewed) BEFORE rent
-- history existed: its older months are being compared against the new rent.
-- Run in the Supabase SQL editor after the new version is deployed.
--
-- 1. Replace the three values below, then run the whole script.
--      tenant name  -> the tenant's name as shown in the app
--      old rent     -> rent charged before the renewal
--      new rent     -> rent from the renewal month onward
--      new rent starts -> first of the month the new rent begins
-- 2. Skip this for units renewed after the update - they record it automatically.

CREATE TABLE IF NOT EXISTS rent_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  flat_id uuid NOT NULL REFERENCES flats(id),
  effective_month date NOT NULL,
  rent numeric(12,2) NOT NULL
);
ALTER TABLE rent_changes ENABLE ROW LEVEL SECURITY;

WITH target AS (
  SELECT id, date_trunc('month', move_in_date)::date AS move_in_month
  FROM flats
  WHERE tenant_name ILIKE '%TENANT NAME%'        -- <- tenant name
    AND deleted_at IS NULL
),
cleared AS (
  DELETE FROM rent_changes WHERE flat_id IN (SELECT id FROM target)
)
INSERT INTO rent_changes (flat_id, effective_month, rent)
SELECT id, move_in_month, 25500 FROM target       -- <- old rent
UNION ALL
SELECT id, DATE '2026-10-01', 27000 FROM target;  -- <- new rent starts / new rent

-- Check: should list the unit with two rows (old rent, then new rent).
SELECT f.flat_no, f.tenant_name, r.effective_month, r.rent
FROM rent_changes r JOIN flats f ON f.id = r.flat_id
ORDER BY f.flat_no, r.effective_month;
