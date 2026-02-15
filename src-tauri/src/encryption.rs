use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use argon2::password_hash::{rand_core::RngCore, SaltString};
use argon2::{Argon2, PasswordHasher};
use std::fs;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::Path;

const NONCE_SIZE: usize = 12;
const CHUNK_SIZE: usize = 64 * 1024; // 64 KB chunks for streaming
const AES_GCM_TAG_SIZE: usize = 16; // AES-GCM authentication tag size
const MAX_ENCRYPTED_CHUNK_SIZE: usize = CHUNK_SIZE + AES_GCM_TAG_SIZE; // Maximum size of encrypted chunk
const MAGIC_HEADER_PASSWORD: &[u8] = b"FTREEENC"; // 8 bytes - password encrypted
const MAGIC_HEADER_BASE: &[u8] = b"FTREEBS1"; // 8 bytes - base encrypted only
const VERSION: u8 = 1;

// Application-level encryption key (32 bytes for AES-256)
// WARNING: This provides only OBFUSCATION-LEVEL protection, not real security!
// The key is embedded in the compiled binary and can be easily extracted.
// This base encryption prevents casual viewing of exported files but should NOT be
// relied upon for protecting sensitive data. Always use password protection for
// any data that requires real security.
// The purpose of this base layer is to:
// 1. Ensure exports are never plaintext SQLite files
// 2. Provide a consistent file format
// 3. Add a minimal barrier to casual access
// 4. Work as a foundation for the optional password encryption layer
const BASE_KEY: [u8; 32] = [
    0x46, 0x61, 0x6d, 0x69, 0x6c, 0x79, 0x54, 0x72, 0x65, 0x65, 0x41, 0x70, 0x70, 0x4b, 0x65, 0x79,
    0x32, 0x30, 0x32, 0x36, 0x56, 0x31, 0x53, 0x65, 0x63, 0x75, 0x72, 0x65, 0x44, 0x61, 0x74, 0x61,
];

/// Encrypts a file with AES-256-GCM using password-based key derivation
/// Uses chunked encryption to avoid loading entire file into memory
pub fn encrypt_file(input_path: &Path, output_path: &Path, password: &str) -> Result<(), String> {
    // Open input file with buffered reader
    let input_file =
        fs::File::open(input_path).map_err(|e| format!("Failed to open input file: {}", e))?;
    let mut reader = BufReader::new(input_file);

    // Generate a random salt for key derivation
    let salt = SaltString::generate(&mut OsRng);

    // Derive encryption key from password using Argon2
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?;

    let hash = password_hash.hash.ok_or("Failed to get hash")?;
    let key_bytes = hash.as_bytes();

    // Ensure we have exactly 32 bytes for AES-256
    let mut key = [0u8; 32];
    let copy_len = key_bytes.len().min(32);
    key[..copy_len].copy_from_slice(&key_bytes[..copy_len]);

    // Create cipher instance
    let cipher = Aes256Gcm::new(key.as_ref().into());

    // Create output file with buffered writer
    let output_file = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let mut writer = BufWriter::new(output_file);

    // Write header: MAGIC_HEADER_PASSWORD + VERSION + SALT_LEN + SALT
    writer
        .write_all(MAGIC_HEADER_PASSWORD)
        .map_err(|e| format!("Failed to write magic header: {}", e))?;

    writer
        .write_all(&[VERSION])
        .map_err(|e| format!("Failed to write version: {}", e))?;

    // Write salt length (1 byte) then salt
    let salt_bytes = salt.as_str().as_bytes();
    let salt_len = salt_bytes.len() as u8;
    writer
        .write_all(&[salt_len])
        .map_err(|e| format!("Failed to write salt length: {}", e))?;

    writer
        .write_all(salt_bytes)
        .map_err(|e| format!("Failed to write salt: {}", e))?;

    // Encrypt and write data in chunks
    let mut chunk_buffer = vec![0u8; CHUNK_SIZE];
    let mut chunk_index: u64 = 0;

    loop {
        // Read next chunk
        let bytes_read = reader
            .read(&mut chunk_buffer)
            .map_err(|e| format!("Failed to read chunk {}: {}", chunk_index, e))?;

        if bytes_read == 0 {
            break; // EOF
        }

        // Generate unique nonce for this chunk
        // Use fully random nonce to ensure maximum entropy and avoid nonce reuse
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt this chunk
        let chunk_data = &chunk_buffer[..bytes_read];
        let ciphertext = cipher
            .encrypt(nonce, chunk_data)
            .map_err(|e| format!("Encryption failed at chunk {}: {}", chunk_index, e))?;

        // Write chunk size (4 bytes), nonce, and encrypted chunk
        let chunk_len = ciphertext.len() as u32;
        writer
            .write_all(&chunk_len.to_le_bytes())
            .map_err(|e| format!("Failed to write chunk size at chunk {}: {}", chunk_index, e))?;

        writer
            .write_all(&nonce_bytes)
            .map_err(|e| format!("Failed to write nonce at chunk {}: {}", chunk_index, e))?;

        writer
            .write_all(&ciphertext)
            .map_err(|e| format!("Failed to write ciphertext at chunk {}: {}", chunk_index, e))?;

        chunk_index += 1;
    }

    // Flush writer to ensure all data is written
    writer
        .flush()
        .map_err(|e| format!("Failed to flush output: {}", e))?;

    Ok(())
}

/// Decrypts a file encrypted with encrypt_file
/// Uses chunked decryption to avoid loading entire file into memory
pub fn decrypt_file(input_path: &Path, output_path: &Path, password: &str) -> Result<(), String> {
    // Open encrypted file with buffered reader
    let input_file =
        fs::File::open(input_path).map_err(|e| format!("Failed to open input file: {}", e))?;
    let mut reader = BufReader::new(input_file);

    // Read and verify magic header
    let mut magic = [0u8; 8];
    reader
        .read_exact(&mut magic)
        .map_err(|e| format!("Failed to read magic header: {}", e))?;

    if &magic != MAGIC_HEADER_PASSWORD {
        return Err("Invalid file format: not a password-encrypted Family Tree database".into());
    }

    // Read version
    let mut version = [0u8; 1];
    reader
        .read_exact(&mut version)
        .map_err(|e| format!("Failed to read version: {}", e))?;

    if version[0] != VERSION {
        return Err(format!("Unsupported encryption version: {}", version[0]));
    }

    // Read salt length, then salt
    let mut salt_len_byte = [0u8; 1];
    reader
        .read_exact(&mut salt_len_byte)
        .map_err(|e| format!("Failed to read salt length: {}", e))?;
    let salt_len = salt_len_byte[0] as usize;

    let mut salt_bytes = vec![0u8; salt_len];
    reader
        .read_exact(&mut salt_bytes)
        .map_err(|e| format!("Failed to read salt: {}", e))?;

    let salt_str =
        String::from_utf8(salt_bytes).map_err(|e| format!("Invalid salt format: {}", e))?;
    let salt =
        SaltString::from_b64(&salt_str).map_err(|e| format!("Failed to parse salt: {}", e))?;

    // Derive key from password using the same salt
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?;

    let hash = password_hash.hash.ok_or("Failed to get hash")?;
    let key_bytes = hash.as_bytes();

    let mut key = [0u8; 32];
    let copy_len = key_bytes.len().min(32);
    key[..copy_len].copy_from_slice(&key_bytes[..copy_len]);

    // Create cipher instance
    let cipher = Aes256Gcm::new(key.as_ref().into());

    // Create output file with buffered writer
    let output_file = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let mut writer = BufWriter::new(output_file);

    // Decrypt chunks
    let mut chunk_index: u64 = 0;
    loop {
        // Read chunk size (4 bytes)
        let mut chunk_len_bytes = [0u8; 4];
        match reader.read_exact(&mut chunk_len_bytes) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                // End of file reached
                break;
            }
            Err(e) => {
                return Err(format!(
                    "Failed to read chunk size at chunk {}: {}",
                    chunk_index, e
                ))
            }
        }
        let chunk_len = u32::from_le_bytes(chunk_len_bytes) as usize;

        // Validate chunk size to prevent memory exhaustion attacks
        if chunk_len > MAX_ENCRYPTED_CHUNK_SIZE {
            return Err(format!(
                "Invalid chunk size {} at chunk {} exceeds maximum allowed size {}",
                chunk_len, chunk_index, MAX_ENCRYPTED_CHUNK_SIZE
            ));
        }

        // Read nonce for this chunk
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        reader
            .read_exact(&mut nonce_bytes)
            .map_err(|e| format!("Failed to read nonce at chunk {}: {}", chunk_index, e))?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Read encrypted chunk
        let mut ciphertext = vec![0u8; chunk_len];
        reader
            .read_exact(&mut ciphertext)
            .map_err(|e| format!("Failed to read ciphertext at chunk {}: {}", chunk_index, e))?;

        // Decrypt this chunk
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
            format!(
                "Decryption failed at chunk {}: incorrect password or corrupted file",
                chunk_index
            )
        })?;

        // Write decrypted chunk
        writer.write_all(&plaintext).map_err(|e| {
            format!(
                "Failed to write decrypted chunk at chunk {}: {}",
                chunk_index, e
            )
        })?;

        chunk_index += 1;
    }

    // Flush writer to ensure all data is written
    writer
        .flush()
        .map_err(|e| format!("Failed to flush output: {}", e))?;

    Ok(())
}

/// Checks if a file is encrypted by looking for the magic header
pub fn is_encrypted(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;

    let mut magic = [0u8; 8];
    match file.read_exact(&mut magic) {
        Ok(_) => Ok(&magic == MAGIC_HEADER_PASSWORD || &magic == MAGIC_HEADER_BASE),
        Err(_) => Ok(false), // File too small or read error, assume not encrypted
    }
}

/// Checks if a file has password encryption (vs just base encryption)
pub fn is_password_encrypted(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;

    let mut magic = [0u8; 8];
    match file.read_exact(&mut magic) {
        Ok(_) => Ok(&magic == MAGIC_HEADER_PASSWORD),
        Err(_) => Ok(false),
    }
}

/// Encrypts a file with base-level encryption (no password)
/// Uses chunked encryption to avoid loading entire file into memory
pub fn encrypt_file_base(input_path: &Path, output_path: &Path) -> Result<(), String> {
    // Open input file with buffered reader
    let input_file =
        fs::File::open(input_path).map_err(|e| format!("Failed to open input file: {}", e))?;
    let mut reader = BufReader::new(input_file);

    // Use the application-level base key
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&BASE_KEY));

    // Create output file with buffered writer
    let output_file = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let mut writer = BufWriter::new(output_file);

    // Write header: MAGIC_HEADER_BASE + VERSION
    writer
        .write_all(MAGIC_HEADER_BASE)
        .map_err(|e| format!("Failed to write magic header: {}", e))?;

    writer
        .write_all(&[VERSION])
        .map_err(|e| format!("Failed to write version: {}", e))?;

    // Encrypt and write data in chunks
    let mut chunk_buffer = vec![0u8; CHUNK_SIZE];
    let mut chunk_index: u64 = 0;

    loop {
        // Read next chunk
        let bytes_read = reader
            .read(&mut chunk_buffer)
            .map_err(|e| format!("Failed to read chunk {}: {}", chunk_index, e))?;

        if bytes_read == 0 {
            break; // EOF
        }

        // Generate unique nonce for this chunk
        // Use fully random nonce to ensure maximum entropy and avoid nonce reuse
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Encrypt this chunk
        let chunk_data = &chunk_buffer[..bytes_read];
        let ciphertext = cipher
            .encrypt(nonce, chunk_data)
            .map_err(|e| format!("Base encryption failed at chunk {}: {}", chunk_index, e))?;

        // Write chunk size (4 bytes), nonce, and encrypted chunk
        let chunk_len = ciphertext.len() as u32;
        writer
            .write_all(&chunk_len.to_le_bytes())
            .map_err(|e| format!("Failed to write chunk size at chunk {}: {}", chunk_index, e))?;

        writer
            .write_all(&nonce_bytes)
            .map_err(|e| format!("Failed to write nonce at chunk {}: {}", chunk_index, e))?;

        writer
            .write_all(&ciphertext)
            .map_err(|e| format!("Failed to write ciphertext at chunk {}: {}", chunk_index, e))?;

        chunk_index += 1;
    }

    // Flush writer to ensure all data is written
    writer
        .flush()
        .map_err(|e| format!("Failed to flush output: {}", e))?;

    Ok(())
}

/// Decrypts a file with base-level encryption (no password)
/// Uses chunked decryption to avoid loading entire file into memory
pub fn decrypt_file_base(input_path: &Path, output_path: &Path) -> Result<(), String> {
    // Open encrypted file with buffered reader
    let input_file =
        fs::File::open(input_path).map_err(|e| format!("Failed to open input file: {}", e))?;
    let mut reader = BufReader::new(input_file);

    // Read and verify magic header
    let mut magic = [0u8; 8];
    reader
        .read_exact(&mut magic)
        .map_err(|e| format!("Failed to read magic header: {}", e))?;

    if &magic != MAGIC_HEADER_BASE {
        return Err("Invalid file format: not a base-encrypted Family Tree database".into());
    }

    // Read version
    let mut version = [0u8; 1];
    reader
        .read_exact(&mut version)
        .map_err(|e| format!("Failed to read version: {}", e))?;

    if version[0] != VERSION {
        return Err(format!("Unsupported encryption version: {}", version[0]));
    }

    // Use the application-level base key
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&BASE_KEY));

    // Create output file with buffered writer
    let output_file = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;
    let mut writer = BufWriter::new(output_file);

    // Decrypt chunks
    let mut chunk_index: u64 = 0;
    loop {
        // Read chunk size (4 bytes)
        let mut chunk_len_bytes = [0u8; 4];
        match reader.read_exact(&mut chunk_len_bytes) {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                // End of file reached
                break;
            }
            Err(e) => {
                return Err(format!(
                    "Failed to read chunk size at chunk {}: {}",
                    chunk_index, e
                ))
            }
        }
        let chunk_len = u32::from_le_bytes(chunk_len_bytes) as usize;

        // Validate chunk size to prevent memory exhaustion attacks
        if chunk_len > MAX_ENCRYPTED_CHUNK_SIZE {
            return Err(format!(
                "Invalid chunk size {} at chunk {} exceeds maximum allowed size {}",
                chunk_len, chunk_index, MAX_ENCRYPTED_CHUNK_SIZE
            ));
        }

        // Read nonce for this chunk
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        reader
            .read_exact(&mut nonce_bytes)
            .map_err(|e| format!("Failed to read nonce at chunk {}: {}", chunk_index, e))?;
        let nonce = Nonce::from_slice(&nonce_bytes);

        // Read encrypted chunk
        let mut ciphertext = vec![0u8; chunk_len];
        reader
            .read_exact(&mut ciphertext)
            .map_err(|e| format!("Failed to read ciphertext at chunk {}: {}", chunk_index, e))?;

        // Decrypt this chunk
        let plaintext = cipher.decrypt(nonce, ciphertext.as_ref()).map_err(|_| {
            format!(
                "Base decryption failed at chunk {}: corrupted file",
                chunk_index
            )
        })?;

        // Write decrypted chunk
        writer.write_all(&plaintext).map_err(|e| {
            format!(
                "Failed to write decrypted chunk at chunk {}: {}",
                chunk_index, e
            )
        })?;

        chunk_index += 1;
    }

    // Flush writer to ensure all data is written
    writer
        .flush()
        .map_err(|e| format!("Failed to flush output: {}", e))?;

    Ok(())
}

/// Encrypts a file with base encryption first, then password encryption on top
/// This provides layered security
pub fn encrypt_file_with_base(
    input_path: &Path,
    output_path: &Path,
    password: Option<&str>,
) -> Result<(), String> {
    // First apply base encryption to a temporary file
    let temp_dir =
        tempfile::tempdir().map_err(|e| format!("Failed to create temp directory: {}", e))?;
    let temp_base_encrypted = temp_dir.path().join("base_encrypted.tmp");

    encrypt_file_base(input_path, &temp_base_encrypted)?;

    // If password is provided and non-empty, encrypt the base-encrypted file with password
    // Otherwise, just use the base-encrypted file
    match password {
        Some(pwd) if !pwd.is_empty() => {
            encrypt_file(&temp_base_encrypted, output_path, pwd)?;
        }
        _ => {
            // No password or empty password - just copy the base-encrypted file
            fs::copy(&temp_base_encrypted, output_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    // Temp dir is cleaned up automatically
    Ok(())
}

/// Decrypts a file, handling both base-only and base+password encryption
pub fn decrypt_file_auto(
    input_path: &Path,
    output_path: &Path,
    password: Option<&str>,
) -> Result<(), String> {
    // Check what type of encryption we have
    let is_pwd_encrypted = is_password_encrypted(input_path)?;

    if is_pwd_encrypted {
        // Password encrypted - decrypt password layer first
        let pwd = password.ok_or("Password required for password-encrypted database")?;
        if pwd.is_empty() {
            return Err("Password cannot be empty".into());
        }

        // Decrypt password layer to temp file
        let _temp_dir =
            tempfile::tempdir().map_err(|e| format!("Failed to create temp directory: {}", e))?;
        let temp_base_encrypted = _temp_dir.path().join("base_encrypted.tmp");

        // Step 1: Decrypt password layer
        decrypt_file(input_path, &temp_base_encrypted, pwd)
            .map_err(|e| format!("Password decryption failed: {}", e))?;

        // Step 2: Decrypt base layer
        decrypt_file_base(&temp_base_encrypted, output_path)
            .map_err(|e| format!("Base decryption failed: {}", e))?;

        // _temp_dir is dropped here, cleaning up temp files
    } else {
        // Only base encrypted
        decrypt_file_base(input_path, output_path)
            .map_err(|e| format!("Base decryption failed: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        // Create test data
        let test_data = b"This is a test SQLite database content";
        fs::write(&original_file, test_data).unwrap();

        // Encrypt
        let password = "test_password_123";
        encrypt_file(&original_file, &encrypted_file, password).unwrap();

        // Verify encrypted file is different from original
        let encrypted_data = fs::read(&encrypted_file).unwrap();
        assert_ne!(
            &encrypted_data[..test_data.len().min(encrypted_data.len())],
            test_data
        );

        // Verify magic header
        assert!(is_encrypted(&encrypted_file).unwrap());
        assert!(!is_encrypted(&original_file).unwrap());

        // Decrypt
        decrypt_file(&encrypted_file, &decrypted_file, password).unwrap();

        // Verify decrypted data matches original
        let decrypted_data = fs::read(&decrypted_file).unwrap();
        assert_eq!(&decrypted_data, test_data);
    }

    #[test]
    fn test_wrong_password() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        let test_data = b"Secret data";
        fs::write(&original_file, test_data).unwrap();

        encrypt_file(&original_file, &encrypted_file, "correct_password").unwrap();

        let result = decrypt_file(&encrypted_file, &decrypted_file, "wrong_password");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Decryption failed"));
    }

    #[test]
    fn test_is_encrypted_detection() {
        let temp_dir = TempDir::new().unwrap();
        let plain_file = temp_dir.path().join("plain.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");

        // Create plain SQLite file (mock header)
        fs::write(&plain_file, b"SQLite format 3\x00").unwrap();

        // Create encrypted file
        let test_data = b"Test data";
        fs::write(&plain_file, test_data).unwrap();
        encrypt_file(&plain_file, &encrypted_file, "password").unwrap();

        assert!(!is_encrypted(&plain_file).unwrap());
        assert!(is_encrypted(&encrypted_file).unwrap());
    }

    #[test]
    fn test_base_encryption_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        // Create test data
        let test_data = b"This is a base encrypted database content";
        fs::write(&original_file, test_data).unwrap();

        // Encrypt with base encryption only
        encrypt_file_base(&original_file, &encrypted_file).unwrap();

        // Verify encrypted file is different from original
        let encrypted_data = fs::read(&encrypted_file).unwrap();
        assert_ne!(&encrypted_data[..test_data.len().min(encrypted_data.len())], test_data);

        // Verify it's encrypted but NOT password encrypted
        assert!(is_encrypted(&encrypted_file).unwrap());
        assert!(!is_password_encrypted(&encrypted_file).unwrap());

        // Decrypt with base decryption
        decrypt_file_base(&encrypted_file, &decrypted_file).unwrap();

        // Verify decrypted data matches original
        let decrypted_data = fs::read(&decrypted_file).unwrap();
        assert_eq!(&decrypted_data, test_data);
    }

    #[test]
    fn test_layered_encryption_with_password_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        // Create test data
        let test_data = b"This is a layered encrypted database with password";
        fs::write(&original_file, test_data).unwrap();

        // Encrypt with base + password (layered encryption)
        let password = "test_password_123";
        encrypt_file_with_base(&original_file, &encrypted_file, Some(password)).unwrap();

        // Verify encrypted file is different from original
        let encrypted_data = fs::read(&encrypted_file).unwrap();
        assert_ne!(&encrypted_data[..test_data.len().min(encrypted_data.len())], test_data);

        // Verify it's encrypted AND password encrypted
        assert!(is_encrypted(&encrypted_file).unwrap());
        assert!(is_password_encrypted(&encrypted_file).unwrap());

        // Decrypt with auto-detection (should handle layered decryption)
        decrypt_file_auto(&encrypted_file, &decrypted_file, Some(password)).unwrap();

        // Verify decrypted data matches original
        let decrypted_data = fs::read(&decrypted_file).unwrap();
        assert_eq!(&decrypted_data, test_data);
    }

    #[test]
    fn test_layered_encryption_base_only_roundtrip() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        // Create test data
        let test_data = b"This is a base-only layered encryption";
        fs::write(&original_file, test_data).unwrap();

        // Encrypt with base only (no password)
        encrypt_file_with_base(&original_file, &encrypted_file, None).unwrap();

        // Verify it's encrypted but NOT password encrypted
        assert!(is_encrypted(&encrypted_file).unwrap());
        assert!(!is_password_encrypted(&encrypted_file).unwrap());

        // Decrypt with auto-detection (should handle base-only)
        decrypt_file_auto(&encrypted_file, &decrypted_file, None).unwrap();

        // Verify decrypted data matches original
        let decrypted_data = fs::read(&decrypted_file).unwrap();
        assert_eq!(&decrypted_data, test_data);
    }

    #[test]
    fn test_layered_encryption_empty_password_treated_as_none() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        // Create test data
        let test_data = b"Test data with empty password";
        fs::write(&original_file, test_data).unwrap();

        // Encrypt with empty password (should be treated as base-only)
        encrypt_file_with_base(&original_file, &encrypted_file, Some("")).unwrap();

        // Verify it's encrypted but NOT password encrypted
        assert!(is_encrypted(&encrypted_file).unwrap());
        assert!(!is_password_encrypted(&encrypted_file).unwrap());

        // Decrypt without password
        decrypt_file_auto(&encrypted_file, &decrypted_file, None).unwrap();

        // Verify decrypted data matches original
        let decrypted_data = fs::read(&decrypted_file).unwrap();
        assert_eq!(&decrypted_data, test_data);
    }

    #[test]
    fn test_decrypt_auto_requires_password_for_password_encrypted() {
        let temp_dir = TempDir::new().unwrap();
        let original_file = temp_dir.path().join("original.db");
        let encrypted_file = temp_dir.path().join("encrypted.db");
        let decrypted_file = temp_dir.path().join("decrypted.db");

        let test_data = b"Password protected data";
        fs::write(&original_file, test_data).unwrap();

        // Encrypt with password
        encrypt_file_with_base(&original_file, &encrypted_file, Some("password123")).unwrap();

        // Verify it's password encrypted
        assert!(is_password_encrypted(&encrypted_file).unwrap());

        // Try to decrypt without password - should fail
        let result = decrypt_file_auto(&encrypted_file, &decrypted_file, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Password required"));

        // Try to decrypt with empty password - should fail
        let result = decrypt_file_auto(&encrypted_file, &decrypted_file, Some(""));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Password cannot be empty"));

        // Try to decrypt with wrong password - should fail
        let result = decrypt_file_auto(&encrypted_file, &decrypted_file, Some("wrong_password"));
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Password decryption failed"));
    }

    #[test]
    fn test_is_password_encrypted_detection() {
        let temp_dir = TempDir::new().unwrap();
        let plain_file = temp_dir.path().join("plain.db");
        let base_encrypted_file = temp_dir.path().join("base_encrypted.db");
        let password_encrypted_file = temp_dir.path().join("password_encrypted.db");

        // Create test data
        let test_data = b"Test data for encryption detection";
        fs::write(&plain_file, test_data).unwrap();

        // Create base-only encrypted file
        encrypt_file_base(&plain_file, &base_encrypted_file).unwrap();

        // Create password-encrypted file
        encrypt_file(&plain_file, &password_encrypted_file, "password").unwrap();

        // Plain file should not be detected as encrypted
        assert!(!is_encrypted(&plain_file).unwrap());
        assert!(!is_password_encrypted(&plain_file).unwrap());

        // Base encrypted file should be detected as encrypted but not password encrypted
        assert!(is_encrypted(&base_encrypted_file).unwrap());
        assert!(!is_password_encrypted(&base_encrypted_file).unwrap());

        // Password encrypted file should be detected as both encrypted and password encrypted
        assert!(is_encrypted(&password_encrypted_file).unwrap());
        assert!(is_password_encrypted(&password_encrypted_file).unwrap());
    }
}
