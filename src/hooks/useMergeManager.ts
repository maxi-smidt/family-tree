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
import { MemberObject } from "@/types/member";

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
          };
        const members = await DatabaseService.getMembers(db);
        const relations = await DatabaseService.getRelations(db);
        const galleryImages = await DatabaseService.getGalleryImages(db);
        const galleryLinks = await DatabaseService.getGalleryMemberLinks(db);
        const relationTypes = await DatabaseService.getRelationTypes(db);
        return {
          members,
          relations,
          galleryImages,
          galleryLinks,
          relationTypes,
        };
      };

      const data1 = await loadFullData(db1);
      const data2 = await loadFullData(db2);

      await newDb.execute("BEGIN TRANSACTION");

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

      for (const m of data1.members) {
        await DatabaseService.addMember(newDb, {
          ...m,
          gender: m.gender as any,
          date: { birth: m.dateOfBirth, death: m.dateOfDeath },
          parents: { paternalParent: null, maternalParent: null },
          position: { x: m.positionX, y: m.positionY },
          isCollapsed: !!m.isCollapsed,
        });
      }

      for (const m2 of data2.members) {
        const match1 = data1.members.find((m1) => MemberObject.equalDB(m1, m2));
        if (match1) {
          idMap2.set(m2.id, match1.id);
          if (
            m2.additionalData &&
            m2.additionalData !== match1.additionalData
          ) {
            const newText = match1.additionalData
              ? `${match1.additionalData}\n\n${m2.additionalData}`
              : m2.additionalData;
            await DatabaseService.updateMember(newDb, match1.id, {
              additionalData: newText,
            });
          }
        } else {
          const newId = getNewId2(m2.id);
          await DatabaseService.addMember(newDb, {
            ...m2,
            id: newId,
            gender: m2.gender as any,
            date: { birth: m2.dateOfBirth, death: m2.dateOfDeath },
            parents: { paternalParent: null, maternalParent: null },
            position: { x: m2.positionX, y: m2.positionY },
            isCollapsed: !!m2.isCollapsed,
          });
        }
      }

      const allRelationTypes = new Set([
        ...data1.relationTypes.map((t) => t.id),
        ...data2.relationTypes.map((t) => t.id),
      ]);
      for (const typeId of allRelationTypes) {
        await DatabaseService.addRelationType(newDb, typeId, "");
      }

      for (const r of data1.relations) {
        await DatabaseService.addRelation(
          newDb,
          r.from_member_id,
          r.to_member_id,
          r.relation_type as any,
        );
      }
      for (const r of data2.relations) {
        const fromId = idMap2.get(r.from_member_id) || r.from_member_id;
        const toId = idMap2.get(r.to_member_id) || r.to_member_id;
        await DatabaseService.addRelation(
          newDb,
          fromId,
          toId,
          r.relation_type as any,
        );
      }

      await newDb.execute("COMMIT TRANSACTION");

      const newDatabaseObj: Database = { id: newDbId, name: newDbName };
      addDatabase(newDatabaseObj);
      await connect(newDatabaseObj);

      toast.success(t("toast-success-merge"));
      return true;
    } catch (e: any) {
      console.error("Merge failed", e);
      toast.error(t("toast-error-merge"));

      if (newDb) {
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
