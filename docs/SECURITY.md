# Security Features

## Database File Encryption

Family Tree supports optional AES-256-GCM encryption for exported database files (.treedb). This feature allows you to protect sensitive family information when sharing or storing database exports.

### How It Works

#### Exporting with Encryption

1. **Navigate** to the Database Management view (Sidebar → Data Management)
2. **Click** the export button (upload icon) for the database you want to export
3. **Choose** whether to encrypt:
   - **"Skip (no encryption)"**: Export as a regular, unencrypted .treedb file
   - **"Confirm"**: Encrypt the export with a password
4. **Enter password** (if encrypting):
   - Minimum 8 characters recommended
   - Confirm password to avoid typos
5. **Select** save location and the database will be exported

#### Importing Encrypted Databases

1. **Navigate** to the Database Management view or use the import button
2. **Select** the .treedb file to import
3. **If encrypted**, you'll be prompted for the password automatically
4. **Enter password** and the database will be decrypted and imported

### Technical Details

- **Encryption Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: Argon2 password hashing
- **Salt & Nonce**: Randomly generated per export
- **File Format**: Magic header `FTREEENC` identifies encrypted files
- **Backward Compatibility**: Unencrypted .treedb files continue to work as before

### Security Considerations

✅ **Strengths:**

- Industry-standard AES-256 encryption
- Strong password-based key derivation with Argon2
- Authenticated encryption (GCM mode prevents tampering)
- Random salt and nonce per export

⚠️ **Important Notes:**

- **Password strength matters**: Use a strong, unique password (8+ characters, mix of letters, numbers, symbols)
- **Password recovery**: If you forget the password, the database **cannot be recovered**
- **Password sharing**: Only share encrypted databases and passwords through secure channels
- **Storage**: Keep backups of both the file and password in secure locations

### Use Cases

**When to use encryption:**

- Sharing family databases via email or cloud storage
- Storing backups on shared/public storage
- Collaborating with others on family history research
- Protecting sensitive information in exported databases

**When encryption may not be needed:**

- Local backups on encrypted drives
- Internal storage on your personal computer
- Databases without sensitive information

### Best Practices

1. **Strong Passwords**: Use at least 12 characters with a mix of uppercase, lowercase, numbers, and symbols
2. **Password Manager**: Consider using a password manager to generate and store strong passwords
3. **Multiple Backups**: Keep both encrypted and unencrypted backups in secure locations
4. **Document Passwords**: Store passwords securely and share the storage method with trusted family members
5. **Test Imports**: After exporting an encrypted database, test importing it to verify the password works

### Troubleshooting

**"Decryption failed: incorrect password or corrupted file"**

- Double-check the password (case-sensitive)
- Ensure the file wasn't corrupted during transfer
- Try re-exporting the database

**"Password required for encrypted database"**

- The file is encrypted and requires the password used during export
- If you don't have the password, the database cannot be recovered

**File won't import**

- Verify the file has the correct .treedb extension
- Check if the file is corrupted (try opening on the computer where it was exported)
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
