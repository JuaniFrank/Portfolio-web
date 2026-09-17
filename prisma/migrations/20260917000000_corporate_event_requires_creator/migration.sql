-- Reverts 20260916010000, which made CorporateEvent.createdByUserId nullable so the
-- seed could load known public corporate actions with no creator. That produced rows
-- every user saw as already applied and nobody could delete: the events UI scopes
-- deletes by createdByUserId, so an ownerless row never matches. Known public actions
-- are seeded as SuggestedCorporateEvent now, which is per-user dismissible.

-- Ownerless rows only ever came from that seed; there is no owner to assign them to.
DELETE FROM "CorporateEvent" WHERE "createdByUserId" IS NULL;

ALTER TABLE "CorporateEvent" DROP CONSTRAINT "CorporateEvent_createdByUserId_fkey";

ALTER TABLE "CorporateEvent" ALTER COLUMN "createdByUserId" SET NOT NULL;

-- Back to RESTRICT: deleting a user must not silently orphan the events they applied.
ALTER TABLE "CorporateEvent" ADD CONSTRAINT "CorporateEvent_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
