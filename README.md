# Family Tree Application

A modern, desktop-based family tree builder application built with Tauri, React, and TypeScript. This application allows users to visually create, manage, and explore their family history using an interactive node-based interface.

## Features

- **Interactive Tree Visualization**: Built with React Flow, allowing for smooth panning, zooming, and dragging of family members.
- **Member Management**: Add, edit, and remove family members with details like names, dates of birth/death, and photos.
- **Life Events Tracking**: Record significant life events (births, marriages, migrations, etc.) with dates, locations, and descriptions.
- **Stories & Biographies**: Write and preserve detailed stories and anecdotes about family members.
- **Timeline View**: Visualize all life events chronologically with filtering and search capabilities.
- **Relationship Linking**: Visually connect parents to children to build the family structure.
- **Gallery**: Upload, manage, and link photos to family members.
- **Local Database**: Uses SQLite for secure, local data persistence of your family trees.
- **Multiple Databases**: Support for managing multiple distinct family trees.
- **Modern UI**: Clean and responsive interface built with Tailwind CSS and Shadcn UI components.
- **Dark/Light Mode**: Support for system theme preferences.
- **Internationalization**: Multi-language support with i18next.

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Desktop Framework**: Tauri (Rust)
- **State Management**: Zustand
- **Visualization**: @xyflow/react (React Flow)
- **Database**: SQLite (via @tauri-apps/plugin-sql)
- **Styling**: Tailwind CSS, Radix UI, Lucide React

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or newer)
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)
- System dependencies for Tauri (see [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites))

### Installation

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd family-tree
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Run the development server:
   ```bash
   npm run tauri dev
   ```
   This will start the Vite server and open the Tauri application window.

### Building for Production

To build the application for your operating system:

```bash
npm run tauri build
```

## Project Structure

- `/src-tauri`: Rust backend code and Tauri configuration.
- `/src`: Frontend React application.
  - `/components`: UI components (FlowPanel, Sidebar, Dialogs, etc.).
  - `/hooks`: Custom React hooks (State management, Settings).
  - `/types`: TypeScript type definitions.
  - `/utils`: Helper functions.
  - `/i18n`: Internationalization configuration and translations.
- `/docs`: Documentation for developers.

## Development

### Internationalization

The application supports multiple languages. For adding or modifying translations, see the [i18n Guide](docs/I18N_GUIDE.md).

To validate i18n implementation:

```bash
npm run check-i18n
```

## License

[MIT](LICENSE)
