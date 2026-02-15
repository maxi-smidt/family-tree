# Family Tree Application

> A modern, cross-platform desktop application for building and exploring your family history through an interactive visual interface.

![Family Tree Application](https://img.shields.io/badge/version-0.1.14-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## Overview

Family Tree is a desktop application that helps you document, organize, and visualize your family genealogy. Built with modern web technologies and compiled as a native desktop application, it provides a powerful yet intuitive interface for preserving your family's stories and connections.

**Key Highlights:**
- 🌳 Interactive visual family tree with drag-and-drop node arrangement
- 📝 Rich biographical information and life event tracking
- 📸 Photo gallery with member linking
- 🔒 Local-first data storage with SQLite (your data stays on your device)
- 🌍 Multi-language support
- 🎨 Clean, modern interface with dark/light mode support

## Features

### Family Tree Management
- **Visual Tree Builder**: Interactive node-based interface for creating and exploring family relationships
- **Member Profiles**: Store names, dates, photos, and biographical information
- **Relationship Linking**: Connect family members through parent-child relationships

### Documentation & Storytelling
- **Life Events**: Track births, marriages, migrations, and other significant moments
- **Timeline View**: Visualize all family events chronologically
- **Stories & Biographies**: Write and preserve detailed narratives about family members

### Data Management
- **Local Database**: Secure SQLite storage on your local machine
- **Multiple Trees**: Support for managing separate family tree databases
- **Photo Gallery**: Upload and organize family photos

### User Experience
- **Modern UI**: Built with Tailwind CSS and Shadcn UI components
- **Responsive Design**: Smooth panning, zooming, and navigation
- **Theme Support**: Automatic dark/light mode based on system preferences
- **Internationalization**: Available in multiple languages

## Tech Stack

This application leverages modern web technologies compiled into a native desktop application:

- **Frontend**: React + TypeScript + Vite
- **Desktop Framework**: Tauri (Rust)
- **UI Components**: Shadcn UI + Tailwind CSS
- **Visualization**: React Flow (@xyflow/react)
- **State Management**: Zustand
- **Database**: SQLite

## Getting Started

### For Users

Download the latest release for your operating system from the [Releases](https://github.com/maxi-smidt/family-tree/releases) page.

### For Developers

See **[SETUP.md](./SETUP.md)** for detailed installation and development instructions.

Quick start:
```bash
git clone https://github.com/maxi-smidt/family-tree.git
cd family-tree
npm install
npm run tauri dev
```

## Documentation

- **[SETUP.md](./SETUP.md)** - Development environment setup and build instructions
- **[AGENTS.md](./AGENTS.md)** - Architecture and development guidelines for contributors
- **[COPILOT.md](./COPILOT.md)** - Guidelines for GitHub Copilot-assisted development
- **[docs/I18N_GUIDE.md](./docs/I18N_GUIDE.md)** - Internationalization conventions and patterns

## Contributing

Contributions are welcome! Please read our development guidelines in [AGENTS.md](./AGENTS.md) before submitting pull requests.

For internationalization work, see the [i18n Guide](docs/I18N_GUIDE.md). Validate translations with:

```bash
npm run check-i18n
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

If you encounter any issues or have questions:
- Open an issue on [GitHub Issues](https://github.com/maxi-smidt/family-tree/issues)
- Check existing issues for solutions to common problems

---

**Made with ❤️ for preserving family histories**
