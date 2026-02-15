use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce, Key,
};
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::{rand_core::RngCore, SaltString};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

const NONCE_SIZE: usize = 12;
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
    0x46, 0x61, 0x6d, 0x69, 0x6c, 0x79, 0x54, 0x72,
    0x65, 0x65, 0x41, 0x70, 0x70, 0x4b, 0x65, 0x79,
    0x32, 0x30, 0x32, 0x36, 0x56, 0x31, 0x53, 0x65,
    0x63, 0x75, 0x72, 0x65, 0x44, 0x61, 0x74, 0x61,
];

/// Encrypts a file with AES-256-GCM using password-based key derivation
pub fn encrypt_file(input_path: &Path, output_path: &Path, password: &str) -> Result<(), String> {
    // Read the input file
    let plaintext = fs::read(input_path)
        .map_err(|e| format!("Failed to read input file: {}", e))?;

    // Generate a random salt for key derivation
    let salt = SaltString::generate(&mut OsRng);
    
    // Derive encryption key from password using Argon2
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?;
    
    let hash = password_hash.hash
        .ok_or("Failed to get hash")?;
    let key_bytes = hash.as_bytes();
    
    // Ensure we have exactly 32 bytes for AES-256
    let mut key = [0u8; 32];
    let copy_len = key_bytes.len().min(32);
    key[..copy_len].copy_from_slice(&key_bytes[..copy_len]);

    // Create cipher instance
    let cipher = Aes256Gcm::new(key.as_ref().into());

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt the data
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("Encryption failed: {}", e))?;

    // Write encrypted file with header: MAGIC_HEADER_PASSWORD + VERSION + SALT + NONCE + CIPHERTEXT
    let mut output = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;

    output.write_all(MAGIC_HEADER_PASSWORD)
        .map_err(|e| format!("Failed to write magic header: {}", e))?;
    
    output.write_all(&[VERSION])
        .map_err(|e| format!("Failed to write version: {}", e))?;
    
    output.write_all(salt.as_str().as_bytes())
        .map_err(|e| format!("Failed to write salt: {}", e))?;
    
    output.write_all(&nonce_bytes)
        .map_err(|e| format!("Failed to write nonce: {}", e))?;
    
    output.write_all(&ciphertext)
        .map_err(|e| format!("Failed to write ciphertext: {}", e))?;

    Ok(())
}

/// Decrypts a file encrypted with encrypt_file
pub fn decrypt_file(input_path: &Path, output_path: &Path, password: &str) -> Result<(), String> {
    // Read the encrypted file
    let mut file = fs::File::open(input_path)
        .map_err(|e| format!("Failed to open input file: {}", e))?;

    // Read and verify magic header
    let mut magic = [0u8; 8];
    file.read_exact(&mut magic)
        .map_err(|e| format!("Failed to read magic header: {}", e))?;
    
    if &magic != MAGIC_HEADER_PASSWORD {
        return Err("Invalid file format: not a password-encrypted Family Tree database".into());
    }

    // Read version
    let mut version = [0u8; 1];
    file.read_exact(&mut version)
        .map_err(|e| format!("Failed to read version: {}", e))?;
    
    if version[0] != VERSION {
        return Err(format!("Unsupported encryption version: {}", version[0]));
    }

    // Read salt (Argon2 salt strings are variable length, but we'll use a fixed size approach)
    let mut salt_bytes = vec![0u8; 88]; // Standard Argon2 salt string length
    file.read_exact(&mut salt_bytes)
        .map_err(|e| format!("Failed to read salt: {}", e))?;
    
    let salt_str = String::from_utf8(salt_bytes)
        .map_err(|e| format!("Invalid salt format: {}", e))?;
    let salt = SaltString::from_b64(&salt_str)
        .map_err(|e| format!("Failed to parse salt: {}", e))?;

    // Read nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    file.read_exact(&mut nonce_bytes)
        .map_err(|e| format!("Failed to read nonce: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Read ciphertext (rest of the file)
    let mut ciphertext = Vec::new();
    file.read_to_end(&mut ciphertext)
        .map_err(|e| format!("Failed to read ciphertext: {}", e))?;

    // Derive key from password using the same salt
    let argon2 = Argon2::default();
    let password_hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| format!("Password hashing failed: {}", e))?;
    
    let hash = password_hash.hash
        .ok_or("Failed to get hash")?;
    let key_bytes = hash.as_bytes();
    
    let mut key = [0u8; 32];
    let copy_len = key_bytes.len().min(32);
    key[..copy_len].copy_from_slice(&key_bytes[..copy_len]);

    // Create cipher instance
    let cipher = Aes256Gcm::new(key.as_ref().into());

    // Decrypt the data
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Decryption failed: incorrect password or corrupted file".to_string())?;

    // Write decrypted file
    fs::write(output_path, plaintext)
        .map_err(|e| format!("Failed to write decrypted file: {}", e))?;

    Ok(())
}

/// Checks if a file is encrypted by looking for the magic header
pub fn is_encrypted(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let mut magic = [0u8; 8];
    match file.read_exact(&mut magic) {
        Ok(_) => Ok(&magic == MAGIC_HEADER_PASSWORD || &magic == MAGIC_HEADER_BASE),
        Err(_) => Ok(false), // File too small or read error, assume not encrypted
    }
}

/// Checks if a file has password encryption (vs just base encryption)
pub fn is_password_encrypted(path: &Path) -> Result<bool, String> {
    let mut file = fs::File::open(path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    let mut magic = [0u8; 8];
    match file.read_exact(&mut magic) {
        Ok(_) => Ok(&magic == MAGIC_HEADER_PASSWORD),
        Err(_) => Ok(false),
    }
}

/// Encrypts a file with base-level encryption (no password)
/// This provides basic protection for all exports
pub fn encrypt_file_base(input_path: &Path, output_path: &Path) -> Result<(), String> {
    // Read the input file
    let plaintext = fs::read(input_path)
        .map_err(|e| format!("Failed to read input file: {}", e))?;

    // Use the application-level base key
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&BASE_KEY));

    // Generate random nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Encrypt the data
    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_ref())
        .map_err(|e| format!("Base encryption failed: {}", e))?;

    // Write encrypted file with header: MAGIC_HEADER_BASE + VERSION + NONCE + CIPHERTEXT
    let mut output = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;

    output.write_all(MAGIC_HEADER_BASE)
        .map_err(|e| format!("Failed to write magic header: {}", e))?;
    
    output.write_all(&[VERSION])
        .map_err(|e| format!("Failed to write version: {}", e))?;
    
    output.write_all(&nonce_bytes)
        .map_err(|e| format!("Failed to write nonce: {}", e))?;
    
    output.write_all(&ciphertext)
        .map_err(|e| format!("Failed to write ciphertext: {}", e))?;

    Ok(())
}

/// Decrypts a file with base-level encryption (no password)
pub fn decrypt_file_base(input_path: &Path, output_path: &Path) -> Result<(), String> {
    // Read the encrypted file
    let mut file = fs::File::open(input_path)
        .map_err(|e| format!("Failed to open input file: {}", e))?;

    // Read and verify magic header
    let mut magic = [0u8; 8];
    file.read_exact(&mut magic)
        .map_err(|e| format!("Failed to read magic header: {}", e))?;
    
    if &magic != MAGIC_HEADER_BASE {
        return Err("Invalid file format: not a base-encrypted Family Tree database".into());
    }

    // Read version
    let mut version = [0u8; 1];
    file.read_exact(&mut version)
        .map_err(|e| format!("Failed to read version: {}", e))?;
    
    if version[0] != VERSION {
        return Err(format!("Unsupported encryption version: {}", version[0]));
    }

    // Read nonce
    let mut nonce_bytes = [0u8; NONCE_SIZE];
    file.read_exact(&mut nonce_bytes)
        .map_err(|e| format!("Failed to read nonce: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    // Read ciphertext (rest of the file)
    let mut ciphertext = Vec::new();
    file.read_to_end(&mut ciphertext)
        .map_err(|e| format!("Failed to read ciphertext: {}", e))?;

    // Use the application-level base key
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&BASE_KEY));

    // Decrypt the data
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| "Base decryption failed: corrupted file".to_string())?;

    // Write decrypted file
    fs::write(output_path, plaintext)
        .map_err(|e| format!("Failed to write decrypted file: {}", e))?;

    Ok(())
}

/// Encrypts a file with base encryption first, then password encryption on top
/// This provides layered security
pub fn encrypt_file_with_base(input_path: &Path, output_path: &Path, password: Option<&str>) -> Result<(), String> {
    // First apply base encryption to a temporary file
    let temp_dir = tempfile::tempdir()
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;
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
pub fn decrypt_file_auto(input_path: &Path, output_path: &Path, password: Option<&str>) -> Result<(), String> {
    // Check what type of encryption we have
    let is_pwd_encrypted = is_password_encrypted(input_path)?;
    
    if is_pwd_encrypted {
        // Password encrypted - decrypt password layer first
        let pwd = password.ok_or("Password required for password-encrypted database")?;
        if pwd.is_empty() {
            return Err("Password cannot be empty".into());
        }
        
        // Decrypt password layer to temp file
        let _temp_dir = tempfile::tempdir()
            .map_err(|e| format!("Failed to create temp directory: {}", e))?;
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
        assert_ne!(&encrypted_data[..test_data.len().min(encrypted_data.len())], test_data);

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
}
