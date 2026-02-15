# Security Features

## Database File Encryption

Family Tree implements a **two-layer security model** for exported database files (.treedb):

1. **Base Encryption Layer** (Always Applied): All exports are automatically encrypted with application-level AES-256-GCM encryption
2. **Password Encryption Layer** (Optional): Additional password-based encryption for enhanced security

This defense-in-depth approach ensures that all exported files have at least basic encryption protection, with the option to add a user password for additional security.

### How It Works

#### Exporting with Encryption

1. **Navigate** to the Database Management view (Sidebar → Data Management)
2. **Click** the export button (upload icon) for the database you want to export
3. **Password Protection Dialog** appears:
   - **"Skip (base encryption only)"**: Export with automatic base encryption (no password required)
   - **"Confirm"**: Add password encryption on top of base encryption
4. **Enter password** (if adding password protection):
   - Minimum 8 characters recommended
   - Confirm password to avoid typos
5. **Select** save location and the database will be exported

**Note**: All exports are encrypted. The choice is whether to add an additional password layer.

#### Importing Encrypted Databases

1. **Navigate** to the Database Management view or use the import button
2. **Select** the .treedb file to import
3. **Automatic Detection**: The app detects whether a password is needed
   - **Base-encrypted only**: Imports automatically (no password prompt)
   - **Password-protected**: You'll be prompted for the password
4. **Enter password** (if needed) and the database will be decrypted and imported

### Technical Details

**Base Encryption (Always Applied):**

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key**: Application-level 256-bit key embedded in the application
- **Purpose**: Prevents casual reading of exported files
- **File Header**: `FTREEBS1` magic header identifies base-encrypted files
- **Automatic**: No user action required; applied transparently

**Password Encryption (Optional):**

- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: Argon2 password hashing
- **Applied To**: The base-encrypted data (layered encryption)
- **File Header**: `FTREEENC` magic header identifies password-encrypted files
- **Salt & Nonce**: Randomly generated per export for both layers

**Security Architecture:**

```
Plaintext SQLite DB
    ↓ [Base Layer]
Base-Encrypted (FTREEBS1)
    ↓ [Password Layer] (optional)
Password-Encrypted (FTREEENC)
```

**Backward Compatibility**:

- Old unencrypted .treedb files (before this feature) can still be imported
- New exports always have at least base encryption
- Password protection is optional but recommended for sensitive data

### Security Considerations

✅ **Strengths:**

- **Defense-in-Depth**: Two layers of encryption provide better protection
- Industry-standard AES-256-GCM encryption for both layers
- Strong password-based key derivation with Argon2
- Authenticated encryption (GCM mode prevents tampering)
- Random salt and nonce per export
- **All exports protected**: Even without a password, files are not plaintext

⚠️ **Important Notes:**

- **Base encryption is obfuscation-level**: The application key is embedded in the app, so it provides basic protection but not strong security without a password
- **Password strength matters**: Use a strong, unique password (8+ characters, mix of letters, numbers, symbols) for real security
- **Password recovery**: If you forget the password, the database **cannot be recovered**
- **Password sharing**: Only share encrypted databases and passwords through secure channels
- **Storage**: Keep backups of both the file and password in secure locations

### Use Cases

**When to add password protection:**

- Sharing family databases via email or cloud storage
- Storing backups on shared/public storage
- Collaborating with others on family history research
- Extra protection for highly sensitive information

**When base encryption alone is sufficient:**

- Local backups on encrypted drives (base encryption + drive encryption = good security)
- Personal storage on your own computer
- Quick exports for personal use
- Databases without highly sensitive information

**Note**: All exports have base encryption, so even without a password, files are not readable as plain SQLite databases.

### Best Practices

1. **Add Passwords for Sharing**: Always use password protection when sharing files with others
2. **Strong Passwords**: Use at least 12 characters with a mix of uppercase, lowercase, numbers, and symbols
3. **Password Manager**: Consider using a password manager to generate and store strong passwords
4. **Multiple Backups**: Keep backups with different protection levels in secure locations
5. **Document Passwords**: Store passwords securely and share the storage method with trusted family members
6. **Test Imports**: After exporting a password-protected database, test importing it to verify the password works

### Troubleshooting

**"Decryption failed: incorrect password or corrupted file"**

- Double-check the password (case-sensitive)
- Ensure the file wasn't corrupted during transfer
- Try re-exporting the database

**"Password required for password-encrypted database"**

- The file was exported with password protection
- You must enter the correct password to import
- If you don't have the password, the database cannot be recovered

**File imports automatically without asking for password**

- This is normal for base-encrypted files (exported without password protection)
- The base encryption is automatically handled by the application
- If you expected password protection, re-export with a password

**"Base decryption failed: corrupted file"**

- The file may have been corrupted during transfer or storage
- Try re-exporting from the original source
- Ensure you're using a compatible version of Family Tree

## Security Updates

To stay protected:

- Keep Family Tree updated to the latest version
- Review the [changelog](../README.md) for security updates
- Report security issues responsibly (see below)

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** open a public issue
2. Email the maintainer directly (see repository contact info)
3. Provide details about the vulnerability and steps to reproduce
4. Allow time for the issue to be addressed before public disclosure

## License & Disclaimer

This software is provided "as is" without warranty. While we use industry-standard encryption, users are responsible for:

- Choosing strong passwords
- Securely storing passwords
- Managing backup copies
- Assessing their own security requirements

See the [LICENSE](../LICENSE) file for full details.
