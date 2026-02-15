use std::fs;
use std::path::{Path, PathBuf};
use rusqlite::Connection;
use serde_json::Value;
use tauri::Manager;
use tauri::path::BaseDirectory;

mod encryption;

const CONSTANTS_STR: &str = include_str!("../../constants.json");

fn get_db_extension() -> String {
    let v: Value = serde_json::from_str(CONSTANTS_STR).unwrap();
    v["EXTENSION"].as_str().unwrap_or("treedb").to_string()
}

fn get_db_path(app: &tauri::AppHandle) -> PathBuf {
    let v: Value = serde_json::from_str(CONSTANTS_STR).unwrap();
    let db_dir = v["DATABASE_DIRECTORY"].as_str().unwrap_or("databases");

    app.path()
        .resolve(db_dir, BaseDirectory::AppConfig)
        .expect("failed to resolve path")
}

fn get_relation_types() -> Vec<String> {
    let v: Value = serde_json::from_str(CONSTANTS_STR).unwrap();
    v["RELATION_TYPES"]
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .map(|v| v.as_str().unwrap_or("").to_string())
        .collect()
}

fn get_metadata_from_path(path: &Path) -> Result<(String, String), String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;

    let id: String = conn.query_row(
        "SELECT value FROM db_metadata WHERE key = 'id'",
        [],
        |r| r.get(0)
    ).map_err(|e| format!("Database ID error: {}", e))?;

    let name: String = conn.query_row(
        "SELECT value FROM db_metadata WHERE key = 'name'",
        [],
        |r| r.get(0)
    ).map_err(|e| format!("Database Name error: {}", e))?;

    Ok((id, name))
}

fn run_migrations(conn: &Connection) -> Result<(), String> {
    let user_version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    let relation_types = get_relation_types();
    let mut relation_inserts = String::new();
    for rt in relation_types {
        if !rt.is_empty() {
            relation_inserts.push_str(&format!("INSERT OR IGNORE INTO relation_types (id) VALUES ('{}');\n", rt));
        }
    }

    let migrations = vec![
        format!("CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY,
            gender TEXT,
            firstName TEXT,
            lastName TEXT,
            maidenName TEXT,
            imageData TEXT,
            dateOfBirth TEXT,
            dateOfDeath TEXT,
            additionalData TEXT,
            isCollapsed BOOLEAN DEFAULT FALSE,
            positionX REAL,
            positionY REAL
        );
        CREATE TABLE IF NOT EXISTS gallery_images (
            id TEXT PRIMARY KEY,
            imageData TEXT,
            title TEXT,
            description TEXT,
            createdAt TEXT,
            uploadedAt TEXT
        );
        CREATE TABLE IF NOT EXISTS gallery_member_link (
            gallery_image_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            PRIMARY KEY (gallery_image_id, member_id),
            FOREIGN KEY (gallery_image_id) REFERENCES gallery_images(id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS db_metadata (
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS relation_types (
            id TEXT PRIMARY KEY,
            description TEXT
        );
        {}
        CREATE TABLE IF NOT EXISTS relations (
            from_member_id TEXT NOT NULL,
            to_member_id TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            PRIMARY KEY (from_member_id, to_member_id, relation_type),
            FOREIGN KEY (from_member_id) REFERENCES members(id) ON DELETE CASCADE,
            FOREIGN KEY (to_member_id) REFERENCES members(id) ON DELETE CASCADE,
            FOREIGN KEY (relation_type) REFERENCES relation_types(id) ON UPDATE CASCADE
        );", relation_inserts),
        "CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            date TEXT NOT NULL,
            location TEXT,
            description TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS stories (
            id TEXT PRIMARY KEY,
            member_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        );".to_string(),
        "CREATE TABLE IF NOT EXISTS events_new (
            id TEXT PRIMARY KEY,
            event_type TEXT NOT NULL,
            date TEXT NOT NULL,
            location TEXT,
            description TEXT,
            created_at TEXT NOT NULL
        );
        INSERT INTO events_new (id, event_type, date, location, description, created_at)
        SELECT id, event_type, date, location, description, created_at FROM events;
        CREATE TABLE IF NOT EXISTS event_member_link (
            event_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            PRIMARY KEY (event_id, member_id),
            FOREIGN KEY (event_id) REFERENCES events_new(id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        INSERT INTO event_member_link (event_id, member_id)
        SELECT id, member_id FROM events;
        DROP TABLE events;
        ALTER TABLE events_new RENAME TO events;
        CREATE TABLE IF NOT EXISTS stories_new (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        INSERT INTO stories_new (id, title, content, created_at, updated_at)
        SELECT id, title, content, created_at, updated_at FROM stories;
        CREATE TABLE IF NOT EXISTS story_member_link (
            story_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            PRIMARY KEY (story_id, member_id),
            FOREIGN KEY (story_id) REFERENCES stories_new(id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        );
        INSERT INTO story_member_link (story_id, member_id)
        SELECT id, member_id FROM stories;
        DROP TABLE stories;
        ALTER TABLE stories_new RENAME TO stories;".to_string(),
    ];

    if user_version < migrations.len() as i32 {
        for (i, sql) in migrations.iter().enumerate().skip(user_version as usize) {
            conn.execute_batch(sql).map_err(|e| format!("Migration {} failed: {}", i, e))?;
            let new_version = i + 1;
            conn.execute(&format!("PRAGMA user_version = {}", new_version), [])
                .map_err(|e| format!("Failed to update version: {}", e))?;
        }
    }

    Ok(())
}

#[tauri::command]
fn initialize_database(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let extension = get_db_extension();
    let path = get_db_path(&app).join(format!("{}.{}", id, extension));

    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    run_migrations(&conn)?;

    Ok(())
}

#[tauri::command]
fn delete_database(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = get_db_path(&app);

    if !path.exists() {
        return Err("Database directory does not exist".into());
    }

    let entries = fs::read_dir(&path)
        .map_err(|e| format!("Failed to access directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_path = entry.path();

        if !file_path.is_file() { continue; }

        let name = entry.file_name().to_string_lossy().into_owned();

        if name.starts_with(&format!("{}.", id)) || name.starts_with(&format!("{}-", id)) {
            fs::remove_file(&file_path).map_err(|e| {
                format!("Failed to delete {}. Is the DB still open? Error: {}", name, e)
            })?;
        }
    }

    Ok(())
}

#[tauri::command]
fn export_database(app: tauri::AppHandle, id: String, target_path: String, password: Option<String>) -> Result<(), String> {
    let extension = get_db_extension();
    let src = get_db_path(&app).join(format!("{}.{}", id, extension));

    let dest = Path::new(&target_path);

    if !src.exists() {
        return Err("Source database file not found".into());
    }

    // Always apply base encryption, with optional password encryption on top
    let pwd_ref = password.as_deref();
    encryption::encrypt_file_with_base(&src, dest, pwd_ref)?;

    Ok(())
}

#[tauri::command]
fn inspect_database(source_path: String) -> Result<Value, String> {
    let src_path = Path::new(&source_path);
    
    // Check if the file is encrypted
    let is_encrypted = encryption::is_encrypted(src_path)?;
    let is_password = encryption::is_password_encrypted(src_path)?;
    
    if is_encrypted {
        // Return info that the file is encrypted
        // Indicate whether it needs a password or just base encryption
        return Ok(serde_json::json!({ 
            "encrypted": true,
            "passwordRequired": is_password,
            "id": null,
            "name": null
        }));
    }
    
    // File is not encrypted (shouldn't happen with new exports, but handle for backward compatibility)
    let (id, name) = get_metadata_from_path(src_path)?;
    Ok(serde_json::json!({ 
        "encrypted": false,
        "passwordRequired": false,
        "id": id, 
        "name": name 
    }))
}

#[tauri::command]
fn import_database(app: tauri::AppHandle, source_path: String, overwrite: bool, password: Option<String>) -> Result<Value, String> {
    let extension = get_db_extension();
    let src = Path::new(&source_path);
    let target_dir = get_db_path(&app);

    // Check if the file is encrypted
    let is_encrypted = encryption::is_encrypted(src)?;
    let is_password = encryption::is_password_encrypted(src)?;
    
    let _temp_dir: Option<tempfile::TempDir>;
    let temp_db_path: PathBuf;
    let src_to_import: &Path;
    
    if is_encrypted {
        // File has encryption (base or base+password)
        
        // If password encryption, require password
        if is_password {
            let pwd = password.as_deref().ok_or("Password required for password-encrypted database")?;
            if pwd.is_empty() {
                return Err("Password cannot be empty".into());
            }
        }
        
        // Create temporary directory for decrypted file
        let temp = tempfile::tempdir()
            .map_err(|e| format!("Failed to create temp directory: {}", e))?;
        temp_db_path = temp.path().join("decrypted.db");
        
        // Decrypt (handles both base-only and base+password)
        encryption::decrypt_file_auto(src, &temp_db_path, password.as_deref())?;
        src_to_import = &temp_db_path;
        _temp_dir = Some(temp); // Keep temp dir alive
    } else {
        // File is not encrypted (old format, backward compatibility)
        _temp_dir = None;
        temp_db_path = PathBuf::new(); // Initialize to avoid uninitialized variable
        src_to_import = src;
    }

    // Get metadata from the (decrypted) database
    let (original_id, db_name) = get_metadata_from_path(src_to_import)?;

    let mut final_id = original_id.clone();
    let mut dest_path = target_dir.join(format!("{}.{}", final_id, extension));

    if dest_path.exists() && !overwrite {
        final_id = uuid::Uuid::new_v4().to_string();
        dest_path = target_dir.join(format!("{}.{}", final_id, extension));
    }

    fs::copy(src_to_import, &dest_path).map_err(|e| format!("Copy failed: {}", e))?;

    if final_id != original_id {
        let conn = Connection::open(&dest_path).map_err(|e| e.to_string())?;
        conn.execute("UPDATE db_metadata SET value = ? WHERE key = 'id'", [&final_id])
            .map_err(|e| format!("Failed to update internal ID: {}", e))?;
    }

    // Cleanup happens automatically when _temp_dir is dropped

    Ok(serde_json::json!({ "id": final_id, "name": db_name }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![delete_database, export_database, import_database, inspect_database, initialize_database])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
