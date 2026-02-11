import Database from "@tauri-apps/plugin-sql";

type Migration = (db: Database) => Promise<void>;

const migrations: Migration[] = [
  async (db) => {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS members (
          id TEXT PRIMARY KEY,
          gender TEXT,
          firstName TEXT,
          lastName TEXT,
          maidenName TEXT,
          imageData TEXT,
          dateOfBirth TEXT,
          dateOfDeath TEXT,
          paternalParentId TEXT,
          maternalParentId TEXT,
          additionalData TEXT,
          isCollapsed BOOLEAN DEFAULT FALSE,
          positionX REAL,
          positionY REAL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS gallery_images (
        id TEXT PRIMARY KEY,
        imageData TEXT,
        title TEXT,
        description TEXT,
        createdAt TEXT,
        uploadedAt TEXT
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS gallery_member_link (
        gallery_image_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        PRIMARY KEY (gallery_image_id, member_id),
        FOREIGN KEY (gallery_image_id) REFERENCES gallery_images(id) ON DELETE CASCADE,
        FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
      );
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS db_metadata (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);
  },
];

export const runMigrations = async (db: Database) => {
  try {
    const versionResult = await db.select<{ user_version: number }[]>(
      "PRAGMA user_version",
    );
    let currentVersion = versionResult[0]?.user_version || 0;

    if (currentVersion >= migrations.length) {
      return;
    }

    for (let i = currentVersion; i < migrations.length; i++) {
      await migrations[i](db);
      const newVersion = i + 1;
      await db.execute(`PRAGMA user_version = ${newVersion}`);
    }
  } catch (error) {
    console.error("Migration failed:", error);
    throw new Error("Database migration failed. Please check the logs.");
  }
};
