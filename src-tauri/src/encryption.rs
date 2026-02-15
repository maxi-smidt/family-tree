use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use argon2::{Argon2, PasswordHasher};
use argon2::password_hash::{rand_core::RngCore, SaltString};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;

const SALT_SIZE: usize = 16;
const NONCE_SIZE: usize = 12;
const MAGIC_HEADER: &[u8] = b"FTREEENC"; // 8 bytes magic header
const VERSION: u8 = 1;

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
    
    let key_bytes = password_hash.hash
        .ok_or("Failed to get hash")?
        .as_bytes();
    
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

    // Write encrypted file with header: MAGIC_HEADER + VERSION + SALT + NONCE + CIPHERTEXT
    let mut output = fs::File::create(output_path)
        .map_err(|e| format!("Failed to create output file: {}", e))?;

    output.write_all(MAGIC_HEADER)
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
    
    if &magic != MAGIC_HEADER {
        return Err("Invalid file format: not an encrypted Family Tree database".into());
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
    
    let key_bytes = password_hash.hash
        .ok_or("Failed to get hash")?
        .as_bytes();
    
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
        Ok(_) => Ok(&magic == MAGIC_HEADER),
        Err(_) => Ok(false), // File too small or read error, assume not encrypted
    }
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
