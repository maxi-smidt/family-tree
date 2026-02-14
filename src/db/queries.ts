export const QUERIES = {
  METADATA: {
    SELECT_ALL: "SELECT * FROM db_metadata",
    SELECT_BY_KEY: "SELECT value FROM db_metadata WHERE key = $1",
    INSERT: "INSERT INTO db_metadata (key, value) VALUES ($1, $2)",
    UPDATE_LAST_OPENED:
      "INSERT OR REPLACE INTO db_metadata (key, value) VALUES ($1, $2)",
  },
  RELATION_TYPES: {
    SELECT_ALL: "SELECT * FROM relation_types",
    INSERT: "INSERT OR IGNORE INTO relation_types (id) VALUES ($1)",
  },
  MEMBERS: {
    SELECT_ALL: "SELECT * FROM members",
    INSERT: `INSERT INTO members (
          id, gender, firstName, lastName, maidenName, imageData, dateOfBirth, dateOfDeath,
          additionalData, positionX, positionY
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    DELETE: "DELETE FROM members WHERE id = $1",
    UPDATE_POSITION:
      "UPDATE members SET positionX = $1, positionY = $2 WHERE id = $3",
  },
  RELATIONS: {
    SELECT_ALL: "SELECT * FROM relations",
    INSERT:
      "INSERT OR IGNORE INTO relations (from_member_id, to_member_id, relation_type) VALUES ($1, $2, $3)",
    DELETE:
      "DELETE FROM relations WHERE from_member_id = $1 AND to_member_id = $2 AND relation_type = $3",
  },
  GALLERY: {
    SELECT_IMAGES: "SELECT * FROM gallery_images",
    SELECT_LINKS: "SELECT * FROM gallery_member_link",
    INSERT_IMAGE:
      "INSERT INTO gallery_images (id, imageData, title, description, createdAt, uploadedAt) VALUES ($1, $2, $3, $4, $5, $6)",
    INSERT_LINK:
      "INSERT OR IGNORE INTO gallery_member_link (gallery_image_id, member_id) VALUES ($1, $2)",
    DELETE_IMAGE: "DELETE FROM gallery_images WHERE id = $1",
    DELETE_LINKS: "DELETE FROM gallery_member_link WHERE gallery_image_id = $1",
  },
  EVENTS: {
    SELECT_ALL: "SELECT * FROM events",
    SELECT_BY_MEMBER: "SELECT * FROM events WHERE member_id = $1 ORDER BY date",
    INSERT:
      "INSERT INTO events (id, member_id, event_type, date, location, description, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    UPDATE:
      "UPDATE events SET event_type = $2, date = $3, location = $4, description = $5 WHERE id = $1",
    DELETE: "DELETE FROM events WHERE id = $1",
  },
  STORIES: {
    SELECT_ALL: "SELECT * FROM stories",
    SELECT_BY_MEMBER: "SELECT * FROM stories WHERE member_id = $1",
    INSERT:
      "INSERT INTO stories (id, member_id, title, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    UPDATE:
      "UPDATE stories SET title = $2, content = $3, updated_at = $4 WHERE id = $1",
    DELETE: "DELETE FROM stories WHERE id = $1",
  },
};
