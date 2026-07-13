import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminService, type BackupRecord } from "@/services/AdminService";
import { useAdminBackupStore } from "./useAdminBackupStore";

vi.mock("@/services/AdminService", () => ({
  AdminService: {
    listBackups: vi.fn(),
    triggerBackup: vi.fn(),
    deleteBackup: vi.fn(),
    downloadBackup: vi.fn(),
  },
}));

const BACKUP: BackupRecord = {
  id: "backup-1",
  created_at: "2026-07-13T10:00:00Z",
  status: "success",
  trigger: "manual",
  filename: "backup.zip",
  size_bytes: 42,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAdminBackupStore.setState({
    backups: [],
    loading: false,
    triggering: false,
    downloadingId: null,
  });
});

describe("useAdminBackupStore", () => {
  it("loads backup records through AdminService", async () => {
    vi.mocked(AdminService.listBackups).mockResolvedValue([BACKUP]);

    await useAdminBackupStore.getState().loadBackups();

    expect(AdminService.listBackups).toHaveBeenCalledOnce();
    expect(useAdminBackupStore.getState().backups).toEqual([BACKUP]);
    expect(useAdminBackupStore.getState().loading).toBe(false);
  });

  it("refreshes records after triggering a backup", async () => {
    vi.mocked(AdminService.triggerBackup).mockResolvedValue(BACKUP);
    vi.mocked(AdminService.listBackups).mockResolvedValue([BACKUP]);

    await expect(
      useAdminBackupStore.getState().triggerBackup(),
    ).resolves.toEqual(BACKUP);

    expect(AdminService.triggerBackup).toHaveBeenCalledOnce();
    expect(AdminService.listBackups).toHaveBeenCalledOnce();
    expect(useAdminBackupStore.getState().backups).toEqual([BACKUP]);
    expect(useAdminBackupStore.getState().triggering).toBe(false);
  });

  it("removes deleted backups without another component-managed fetch", async () => {
    useAdminBackupStore.setState({ backups: [BACKUP] });
    vi.mocked(AdminService.deleteBackup).mockResolvedValue(undefined);

    await useAdminBackupStore.getState().deleteBackup(BACKUP.id);

    expect(AdminService.deleteBackup).toHaveBeenCalledWith(BACKUP.id);
    expect(useAdminBackupStore.getState().backups).toEqual([]);
  });

  it("tracks the active download and delegates blob retrieval to AdminService", async () => {
    const blob = new Blob(["backup"]);
    let resolveDownload: (value: Blob) => void = () => undefined;
    vi.mocked(AdminService.downloadBackup).mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolveDownload = resolve;
      }),
    );

    const download = useAdminBackupStore.getState().downloadBackup(BACKUP.id);

    expect(AdminService.downloadBackup).toHaveBeenCalledWith(BACKUP.id);
    expect(useAdminBackupStore.getState().downloadingId).toBe(BACKUP.id);

    resolveDownload(blob);
    await expect(download).resolves.toBe(blob);
    expect(useAdminBackupStore.getState().downloadingId).toBeNull();
  });
});
