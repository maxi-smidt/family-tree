import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DatabaseManagementView } from "./DatabaseManagementView";

// Mock the hooks
vi.mock("@/hooks/useFamilyTreeSettings", () => ({
  useFamilyTreeSettings: vi.fn((selector) => {
    const state = {
      databases: [
        { id: "1", name: "Test Database 1" },
        { id: "2", name: "Test Database 2" },
      ],
      selectedDatabase: { id: "1", name: "Test Database 1" },
      setSelectedDatabase: vi.fn(),
      addDatabase: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock("@/hooks/useDatabaseManager", () => ({
  useDatabaseManager: () => ({
    exportDatabase: vi.fn(),
    importDatabase: vi.fn(),
    importDatabaseCheck: vi.fn(),
  }),
}));

vi.mock("@/hooks/useDatabaseStore", () => ({
  useDatabaseStore: () => ({
    connect: vi.fn(),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("DatabaseManagementView", () => {
  it("renders the component title", () => {
    render(<DatabaseManagementView />);
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("renders create and import buttons", () => {
    render(<DatabaseManagementView />);
    expect(screen.getByText("create-button")).toBeInTheDocument();
    expect(screen.getByText("import-button")).toBeInTheDocument();
  });

  it("renders the database table with correct headers", () => {
    render(<DatabaseManagementView />);
    expect(screen.getByText("table-name")).toBeInTheDocument();
    expect(screen.getByText("table-id")).toBeInTheDocument();
    expect(screen.getByText("table-actions")).toBeInTheDocument();
  });

  it("displays databases in the table", () => {
    render(<DatabaseManagementView />);
    expect(screen.getAllByText("Test Database 1")).toHaveLength(2); // One in table, one in selected label
    expect(screen.getByText("Test Database 2")).toBeInTheDocument();
  });

  it("shows the selected database", () => {
    render(<DatabaseManagementView />);
    expect(screen.getByText("selected-label")).toBeInTheDocument();
  });
});
