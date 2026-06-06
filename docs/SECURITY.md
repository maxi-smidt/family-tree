# Security

## Authentication & authorization

- **Local accounts**: username/password, hashed with **bcrypt**. Sessions use
  **JWT** bearer tokens.
- **Authentik (OIDC)**: optional single sign-on. Enabled when the
  `AUTHENTIK_*` environment variables are set. New users can be auto-provisioned;
  membership of `AUTHENTIK_ADMIN_GROUP` grants admin.
- **Admin-managed users**: self-registration is off by default. The first
  account (seeded from `FIRST_ADMIN_*`) is an admin; admins create further users
  and can toggle self-registration at runtime.
- **Owned + shared trees**: every tree has an owner and can be shared with other
  users as `viewer` (read-only) or `editor` (read/write). The backend enforces
  this on every request (`get_readable_tree` / `get_writable_tree`).

## Data at rest

The database is **not** encrypted at rest — it relies on the security of the
host and PostgreSQL. Protect the deployment with the usual measures (firewall,
TLS termination at your reverse proxy, disk encryption, database credentials).

Uploaded media (member photos, gallery images) is stored on the filesystem under
`DATA_PATH/media` with random UUID filenames and served from `/api/media/...`.

## Export encryption

Encryption is applied **only to exported `.treedb` files** — this is the one
place data leaves the server.

- **Algorithm**: AES-256-GCM (authenticated encryption).
- **Key derivation**: scrypt.
- **Always encrypted**: every export is encrypted. If you don't provide a
  password, the file is encrypted with the server's `SECRET_KEY`; if you do, the
  key is derived from your password instead.
- **File header**: a `FTREE1` magic prefix plus a flag byte indicating whether
  the file is password-protected.

### Exporting

1. Open the **Database Management** view.
2. Click the export (upload) icon for a tree.
3. Optionally enter a password, or skip for server-key encryption.
4. The encrypted `.treedb` file downloads through your browser.

### Importing

1. Click **Import** and choose a `.treedb` file.
2. The app inspects the file; if it is password-protected you are prompted.
3. The tree is imported as a **new** tree you own, with all ids regenerated so it
   never collides with existing data.

> **Password recovery**: a password-protected export cannot be recovered if the
> password is lost. Server-key-encrypted exports can only be imported by the same
> instance (same `SECRET_KEY`).

## Reporting security issues

If you discover a vulnerability, please **do not** open a public issue. Email the
maintainer directly with details and steps to reproduce, and allow time for a fix
before public disclosure.

## Disclaimer

This software is provided "as is" without warranty. Operators are responsible for
securing their deployment, choosing strong passwords, and managing backups. See
the [LICENSE](../LICENSE) file for full details.
