# Family Tree Project Context

## Overview

This project is a local-first desktop application for creating and visualizing family trees. It is built using **Tauri** and **React**, leveraging **React Flow** for the interactive graph canvas.

## Tech Stack

- **Framework**: React (Vite) + TypeScript
- **Native Runtime**: Tauri (Rust)
- **State Management**: Zustand (`useFamilyStore`)
- **UI Library**: Shadcn UI + Tailwind CSS
- **Graph/Visualization**: @xyflow/react (React Flow)
- **Layout Engine**: Dagre.js (`layoutUtils.ts`)
- **Icons**: Lucide React

## Core Concepts

### Data Model (`Member`)

The core entity is the `Member` (defined in `src/types/member.ts`).

- **Identification**: `id` (UUID).
- **Genealogy**: `parents` object containing `paternalParent` and `maternalParent` IDs.
- **Attributes**: `gender` (male/female/other), `date` (birth/death), `imageData` (base64).
- **Layout**: `position` {x, y} managed by React Flow but calculated via `layoutUtils`.

### Layout Logic

- **Automatic Layout**: Handled in `src/utils/layoutUtils.ts`.
- **Strategy**:
  - Uses `dagre` for topological sorting (generations).
  - Enforces **Paternal (Father)** on the Left and **Maternal (Mother)** on the Right for consistent visualization.
  - Y-axis is adjusted based on birth year (timeline view) where possible.

## Development Guidelines

1. **State Updates**: Use `updateMemberPartial` from the family store for granular updates to avoid overwriting data.
2. **File Handling**: Use Tauri's `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-dialog` for file operations (images, saving/loading).
3. **Component Structure**:
   - `components/flowpanel`: Canvas-related controls, member sheets, and edit modes.
   - `components/ui`: Reusable UI atoms (Shadcn). **Do not modify these files directly** as they are downloaded/generated components.
   - `types`: Shared TypeScript interfaces.

## Current Objectives

- Maintain strict typing for `Member` and `MemberDB`.
- Ensure visual distinction between maternal and paternal lines.
- Implement validation logic for connections (e.g., ensuring a "Father" node is actually Male).
- Optimize the layout algorithm to handle complex relationships without overlapping.
