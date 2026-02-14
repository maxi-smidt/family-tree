import { useState } from "react";
import { useFamilyTreeSettings } from "./useFamilyTreeSettings";
import { useDatabaseStore } from "./useDatabaseStore";
import { Database } from "@/types/database";
import { DatabaseService } from "@/services/DatabaseService";
import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import { DATABASE_DIRECTORY, EXTENSION } from "@/constants";
import DatabaseSql from "@tauri-apps/plugin-sql";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { MemberObject, RelationType } from "@/types/member";

const EMPTY_DB_ID = "empty_db";

export const useMergeManager = () => {
  const { t } = useTranslation(undefined, {
    keyPrefix: "hooks.merge-manager",
  });
  const { addDatabase, selectedDatabase } = useFamilyTreeSettings();
  const { connect, disconnect } = useDatabaseStore();
  const [isMerging, setIsMerging] = useState(false);

  const performMerge = async (
    db1Id: string,
    db2Id: string,
    newDbName: string,
  ) => {
    if (!newDbName) {
      toast.error(t("toast-error-name"));
      return;
    }

    setIsMerging(true);
    const newDbId = crypto.randomUUID();
    const originalDb = selectedDatabase;
    let db1, db2, newDb;
    let transactionStarted = false;

    try {
      if (originalDb) {
        await disconnect();
      }

      await invoke("initialize_database", { id: newDbId });

      const appConfigPath = await appConfigDir();
      const getPath = (id: string) =>
        join(appConfigPath, DATABASE_DIRECTORY, `${id}.${EXTENSION}`);

      const newDbPath = await getPath(newDbId);
      newDb = await DatabaseSql.load(`sqlite:${newDbPath}`);

      if (db1Id !== EMPTY_DB_ID) {
        const db1Path = await getPath(db1Id);
        db1 = await DatabaseSql.load(`sqlite:${db1Path}`);
      }
      if (db2Id !== EMPTY_DB_ID) {
        const db2Path = await getPath(db2Id);
        db2 = await DatabaseSql.load(`sqlite:${db2Path}`);
      }

      const loadFullData = async (db: DatabaseSql | undefined) => {
        if (!db)
          return {
            members: [],
            relations: [],
            galleryImages: [],
            galleryLinks: [],
            relationTypes: [],
            events: [],
            eventLinks: [],
            stories: [],
            storyLinks: [],
          };
        const members = await DatabaseService.getMembers(db);
        const relations = await DatabaseService.getRelations(db);
        const galleryImages = await DatabaseService.getGalleryImages(db);
        const galleryLinks = await DatabaseService.getGalleryMemberLinks(db);
        const relationTypes = await DatabaseService.getRelationTypes(db);
        const events = await DatabaseService.getEvents(db);
        const eventLinks = await DatabaseService.getEventMemberLinks(db);
        const stories = await DatabaseService.getStories(db);
        const storyLinks = await DatabaseService.getStoryMemberLinks(db);
        return {
          members,
          relations,
          galleryImages,
          galleryLinks,
          relationTypes,
          events,
          eventLinks,
          stories,
          storyLinks,
        };
      };

      const data1 = await loadFullData(db1);
      const data2 = await loadFullData(db2);

      // Start transaction with proper error handling
      try {
        await newDb.execute("BEGIN TRANSACTION");
        transactionStarted = true;
      } catch (e) {
        throw new Error(`Failed to start transaction: ${e}`);
      }

      await DatabaseService.initMetadata(
        newDb,
        newDbId,
        newDbName,
        new Date().toISOString(),
      );

      const idMap2 = new Map<string, string>();
      const getNewId2 = (oldId: string) => {
        if (!idMap2.has(oldId)) idMap2.set(oldId, crypto.randomUUID());
        return idMap2.get(oldId)!;
      };

      // Track merge statistics
      let duplicateMembers = 0;
      let mergedNotesCount = 0;
      let skippedRelations = 0;
      let skippedGalleryLinks = 0;
      let duplicateImages = 0;

      for (const m of data1.members) {
        const validGender =
          m.gender === "m" || m.gender === "f" ? m.gender : "o";
        await DatabaseService.addMember(newDb, {
          ...m,
          gender: validGender as "m" | "f" | "o",
          date: { birth: m.dateOfBirth, death: m.dateOfDeath },
          parents: { paternalParent: null, maternalParent: null },
          position: { x: m.positionX, y: m.positionY },
          isCollapsed: !!m.isCollapsed,
        });
      }

      for (const m2 of data2.members) {
        const match1 = data1.members.find((m1) => MemberObject.equalDB(m1, m2));
        if (match1) {
          duplicateMembers++;
          idMap2.set(m2.id, match1.id);
          if (
            m2.additionalData &&
            m2.additionalData !== match1.additionalData
          ) {
            mergedNotesCount++;
            const newText = match1.additionalData
              ? `${match1.additionalData}\n\n${m2.additionalData}`
              : m2.additionalData;
            await DatabaseService.updateMember(newDb, match1.id, {
              additionalData: newText,
            });
          }
        } else {
          const newId = getNewId2(m2.id);
          const validGender =
            m2.gender === "m" || m2.gender === "f" ? m2.gender : "o";
          await DatabaseService.addMember(newDb, {
            ...m2,
            id: newId,
            gender: validGender as "m" | "f" | "o",
            date: { birth: m2.dateOfBirth, death: m2.dateOfDeath },
            parents: { paternalParent: null, maternalParent: null },
            position: { x: m2.positionX, y: m2.positionY },
            isCollapsed: !!m2.isCollapsed,
          });
        }
      }

      // Create a set of all valid member IDs in the merged database
      const allMemberIds = new Set([
        ...data1.members.map((m) => m.id),
        ...Array.from(idMap2.values()),
      ]);

      // Merge relation types first
      const allRelationTypes = new Set([
        ...data1.relationTypes.map((t) => t.id),
        ...data2.relationTypes.map((t) => t.id),
      ]);
      for (const typeId of allRelationTypes) {
        await DatabaseService.addRelationType(newDb, typeId, "");
      }

      // Merge relations from db1
      for (const r of data1.relations) {
        // Validate relation type exists
        if (!allRelationTypes.has(r.relation_type)) {
          console.warn(
            `Skipping relation with invalid type: ${r.relation_type}`,
          );
          skippedRelations++;
          continue;
        }
        const relationType = r.relation_type as RelationType;
        await DatabaseService.addRelation(
          newDb,
          r.from_member_id,
          r.to_member_id,
          relationType,
        );
      }

      // Merge relations from db2
      for (const r of data2.relations) {
        const fromId = idMap2.get(r.from_member_id) || r.from_member_id;
        const toId = idMap2.get(r.to_member_id) || r.to_member_id;

        // Validate relation type exists
        if (!allRelationTypes.has(r.relation_type)) {
          console.warn(
            `Skipping relation with invalid type: ${r.relation_type}`,
          );
          skippedRelations++;
          continue;
        }

        const relationType = r.relation_type as RelationType;
        await DatabaseService.addRelation(newDb, fromId, toId, relationType);
      }

      // Merge gallery images from db1 first
      const processedImageData = new Map<string, string>(); // Map imageData -> id

      for (const img of data1.galleryImages) {
        processedImageData.set(img.imageData, img.id);
        await DatabaseService.addGalleryImage(
          newDb,
          img.id,
          {
            imageData: img.imageData,
            title: img.title,
            description: img.description,
            linkedMemberIds: [],
          },
          img.createdAt,
        );
      }

      // Merge gallery images from db2 with content-based deduplication and ID mapping
      for (const img of data2.galleryImages) {
        // Check if we've seen this exact image data before
        const existingId = processedImageData.get(img.imageData);
        if (existingId) {
          // This is a duplicate - map the old ID to the existing one
          idMap2.set(img.id, existingId);
          duplicateImages++;
          continue;
        }

        // Not a duplicate - add with new ID
        const newImageId = getNewId2(img.id);
        processedImageData.set(img.imageData, newImageId);

        await DatabaseService.addGalleryImage(
          newDb,
          newImageId,
          {
            imageData: img.imageData,
            title: img.title,
            description: img.description,
            linkedMemberIds: [],
          },
          img.createdAt,
        );
      }

      // Merge Gallery Links with validation
      for (const link of data1.galleryLinks) {
        // Validate member exists in merged database
        if (!allMemberIds.has(link.member_id)) {
          console.warn(
            `Skipping gallery link: member ${link.member_id} not found`,
          );
          skippedGalleryLinks++;
          continue;
        }
        await DatabaseService.linkGalleryImageToMember(
          newDb,
          link.gallery_image_id,
          link.member_id,
        );
      }

      for (const link of data2.galleryLinks) {
        // Map member ID if it was changed during merge
        const memberId = idMap2.get(link.member_id) || link.member_id;
        // Map gallery image ID if it was changed during merge (duplicate image)
        const galleryImageId =
          idMap2.get(link.gallery_image_id) || link.gallery_image_id;

        // Validate member exists in merged database
        if (!allMemberIds.has(memberId)) {
          console.warn(`Skipping gallery link: member ${memberId} not found`);
          skippedGalleryLinks++;
          continue;
        }

        await DatabaseService.linkGalleryImageToMember(
          newDb,
          galleryImageId,
          memberId,
        );
      }

      // Merge Events
      let mergedEvents = 0;
      for (const event of data1.events) {
        await DatabaseService.addEvent(
          newDb,
          event.id,
          {
            eventType: event.event_type,
            date: event.date,
            location: event.location,
            description: event.description,
          },
          event.created_at,
        );
        mergedEvents++;
      }

      for (const event of data2.events) {
        const newEventId = getNewId2(event.id);
        await DatabaseService.addEvent(
          newDb,
          newEventId,
          {
            eventType: event.event_type,
            date: event.date,
            location: event.location,
            description: event.description,
          },
          event.created_at,
        );
        mergedEvents++;
      }

      // Merge Event Links
      let mergedEventLinks = 0;
      for (const link of data1.eventLinks) {
        // Validate member exists in merged database
        if (allMemberIds.has(link.member_id)) {
          await DatabaseService.linkEventToMember(
            newDb,
            link.event_id,
            link.member_id,
          );
          mergedEventLinks++;
        }
      }

      for (const link of data2.eventLinks) {
        // Map both event and member IDs
        const eventId = idMap2.get(link.event_id) || link.event_id;
        const memberId = idMap2.get(link.member_id) || link.member_id;

        // Validate member exists in merged database
        if (allMemberIds.has(memberId)) {
          await DatabaseService.linkEventToMember(newDb, eventId, memberId);
          mergedEventLinks++;
        }
      }

      // Merge Stories
      let mergedStories = 0;
      for (const story of data1.stories) {
        await DatabaseService.addStory(
          newDb,
          story.id,
          {
            title: story.title,
            content: story.content,
          },
          story.created_at,
        );
        mergedStories++;
      }

      for (const story of data2.stories) {
        const newStoryId = getNewId2(story.id);
        await DatabaseService.addStory(
          newDb,
          newStoryId,
          {
            title: story.title,
            content: story.content,
          },
          story.created_at,
        );
        mergedStories++;
      }

      // Merge Story Links
      let mergedStoryLinks = 0;
      for (const link of data1.storyLinks) {
        // Validate member exists in merged database
        if (allMemberIds.has(link.member_id)) {
          await DatabaseService.linkStoryToMember(
            newDb,
            link.story_id,
            link.member_id,
          );
          mergedStoryLinks++;
        }
      }

      for (const link of data2.storyLinks) {
        // Map both story and member IDs
        const storyId = idMap2.get(link.story_id) || link.story_id;
        const memberId = idMap2.get(link.member_id) || link.member_id;

        // Validate member exists in merged database
        if (allMemberIds.has(memberId)) {
          await DatabaseService.linkStoryToMember(newDb, storyId, memberId);
          mergedStoryLinks++;
        }
      }

      await newDb.execute("COMMIT TRANSACTION");

      const newDatabaseObj: Database = { id: newDbId, name: newDbName };
      addDatabase(newDatabaseObj);
      await connect(newDatabaseObj);

      // Show detailed success message
      const totalMembers = data1.members.length + data2.members.length;
      const uniqueMembers = totalMembers - duplicateMembers;

      let summary = `Successfully merged databases! ${uniqueMembers} unique members`;
      if (duplicateMembers > 0) {
        summary += `, ${duplicateMembers} duplicates merged`;
      }
      if (mergedNotesCount > 0) {
        summary += `, ${mergedNotesCount} notes combined`;
      }
      if (duplicateImages > 0) {
        summary += `, ${duplicateImages} duplicate images removed`;
      }
      if (mergedEvents > 0) {
        summary += `, ${mergedEvents} events`;
      }
      if (mergedStories > 0) {
        summary += `, ${mergedStories} stories`;
      }
      if (skippedRelations > 0 || skippedGalleryLinks > 0) {
        summary += `. Warning: ${skippedRelations + skippedGalleryLinks} items skipped due to validation errors`;
      }

      toast.success(summary, { duration: 6000 });
      return true;
    } catch (e: any) {
      console.error("Merge failed", e);
      toast.error(t("toast-error-merge"));

      // Only attempt rollback if transaction was started
      if (newDb && transactionStarted) {
        try {
          await newDb.execute("ROLLBACK TRANSACTION");
        } catch (rollbackErr) {
          console.error("Rollback failed", rollbackErr);
        }
      }

      try {
        await invoke("delete_database", { id: newDbId });
      } catch (cleanupError) {
        console.error("Failed to cleanup failed merge database", cleanupError);
      }

      if (originalDb) {
        await connect(originalDb);
      }
      return false;
    } finally {
      if (db1) await db1.close();
      if (db2) await db2.close();
      if (newDb) await newDb.close();
      setIsMerging(false);
    }
  };

  return { isMerging, performMerge };
};
