use std::fs;
use std::path::{Path, PathBuf};
use rusqlite::Connection;
use serde_json::Value;
use tauri::Manager;
use tauri::path::BaseDirectory;

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
fn export_database(app: tauri::AppHandle, id: String, target_path: String) -> Result<(), String> {
    let extension = get_db_extension();
    let src = get_db_path(&app).join(format!("{}.{}", id, extension));

    let dest = Path::new(&target_path);

    if !src.exists() {
        return Err("Source database file not found".into());
    }

    fs::copy(&src, dest).map_err(|e| format!("Failed to copy database: {}", e))?;

    Ok(())
}

#[tauri::command]
fn inspect_database(source_path: String) -> Result<Value, String> {
    let (id, name) = get_metadata_from_path(Path::new(&source_path))?;
    Ok(serde_json::json!({ "id": id, "name": name }))
}

#[tauri::command]
fn import_database(app: tauri::AppHandle, source_path: String, overwrite: bool) -> Result<Value, String> {
    let extension = get_db_extension();
    let src = Path::new(&source_path);
    let target_dir = get_db_path(&app);

    let (original_id, db_name) = get_metadata_from_path(src)?;

    let mut final_id = original_id.clone();
    let mut dest_path = target_dir.join(format!("{}.{}", final_id, extension));

    if dest_path.exists() && !overwrite {
        final_id = uuid::Uuid::new_v4().to_string();
        dest_path = target_dir.join(format!("{}.{}", final_id, extension));
    }

    fs::copy(src, &dest_path).map_err(|e| format!("Copy failed: {}", e))?;

    if final_id != original_id {
        let conn = Connection::open(&dest_path).map_err(|e| e.to_string())?;
        conn.execute("UPDATE db_metadata SET value = ? WHERE key = 'id'", [&final_id])
            .map_err(|e| format!("Failed to update internal ID: {}", e))?;
    }

    Ok(serde_json::json!({ "id": final_id, "name": db_name }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![delete_database, export_database, import_database, inspect_database])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
