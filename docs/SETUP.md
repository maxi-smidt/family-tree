# Setup Guide

This guide will help you set up the Family Tree application for development on your local machine.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

### Required Software

- **Node.js** (v16 or newer)
  - Download from [nodejs.org](https://nodejs.org/)
  - Verify installation: `node --version`

- **Rust** (latest stable version)
  - Install via [rustup](https://www.rust-lang.org/tools/install)
  - Verify installation: `rustc --version`

- **System Dependencies for Tauri**
  - Follow the [Tauri Prerequisites Guide](https://tauri.app/v1/guides/getting-started/prerequisites) for your operating system:
    - **Linux**: Install required libraries (webkit2gtk, libssl-dev, etc.)
    - **macOS**: Xcode Command Line Tools
    - **Windows**: Microsoft Visual Studio C++ Build Tools

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/maxi-smidt/family-tree.git
cd family-tree
```

### 2. Install Dependencies

Install all Node.js dependencies:

```bash
npm install
```

This will install both frontend and Tauri CLI dependencies.

### 3. Development Mode

Run the application in development mode:

```bash
npm run tauri dev
```

This command will:
- Start the Vite development server for hot module replacement
- Compile the Rust backend
- Open the Tauri application window

**Note**: The first build may take several minutes as Rust compiles all dependencies.

### 4. Build for Production

To create a production build for your operating system:

```bash
npm run tauri build
```

The compiled application will be available in `src-tauri/target/release/`.

## Development Workflow

### Running Tests

Execute the test suite with Vitest:

```bash
npm test
```

For watch mode during development:

```bash
npm test -- --watch
```

### Code Quality

The project uses **Prettier** for code formatting. Git hooks (via Husky) automatically format code on commit.

To manually format all files:

```bash
npx prettier --write .
```

### Version Management

Bump the application version using the provided scripts:

```bash
npm run bump:patch  # 0.1.0 -> 0.1.1
npm run bump:minor  # 0.1.0 -> 0.2.0
npm run bump:major  # 0.1.0 -> 1.0.0
```

## Project Structure

```
family-tree/
├── src/                    # Frontend React application
│   ├── components/         # React components
│   ├── hooks/              # Custom React hooks (including Zustand store)
│   ├── types/              # TypeScript type definitions
│   ├── utils/              # Helper functions and utilities
│   ├── services/           # Database and business logic services
│   ├── db/                 # Database queries and schemas
│   └── i18n/               # Internationalization files
├── src-tauri/              # Rust backend
│   ├── src/                # Rust source code
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
├── public/                 # Static assets
├── scripts/                # Build and utility scripts
└── package.json            # Node.js dependencies and scripts
```

## Common Issues

### Database Not Opening

If the database fails to open or create:
- Ensure SQLite is properly installed
- Check file permissions in the application data directory
- Try deleting and recreating the database file

### Tauri Build Fails

If the Tauri build fails:
- Ensure all system dependencies are installed (see Prerequisites)
- Clear Rust build cache: `cd src-tauri && cargo clean`
- Update Rust: `rustup update`

### Frontend Hot Reload Not Working

If hot module replacement isn't working:
- Clear Vite cache: `rm -rf node_modules/.vite`
- Restart the development server

## Additional Resources

- [Tauri Documentation](https://tauri.app/)
- [React Documentation](https://react.dev/)
- [Vite Documentation](https://vitejs.dev/)
- [Zustand Documentation](https://zustand-demo.pmnd.rs/)

## Next Steps

After completing the setup:
1. Review [AGENTS.md](./AGENTS.md) for architecture and development guidelines
2. Explore the [src/components](./src/components) directory to understand the UI structure
3. Check [src/hooks/useFamilyStore.ts](./src/hooks/useFamilyStore.ts) for state management patterns
4. Read [COPILOT.md](./COPILOT.md) if you're using GitHub Copilot for development
5. See [I18N_GUIDE.md](./I18N_GUIDE.md) for internationalization conventions

---

For questions or issues, please open an issue on the [GitHub repository](https://github.com/maxi-smidt/family-tree/issues).
