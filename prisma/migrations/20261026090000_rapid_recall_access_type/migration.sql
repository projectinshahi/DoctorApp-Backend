-- free or premium per Rapid Recall deck, the same choice a lesson has.
--
-- Defaults to premium: until now every deck sat behind the rapid_recall plan
-- feature, so shipping this unlocks nothing by surprise. An admin opts a deck
-- into free.
ALTER TABLE "rapid_recalls" ADD COLUMN "accessType" "AccessType" NOT NULL DEFAULT 'premium';
