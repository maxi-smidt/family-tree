import { useCallback, useState } from "react";
import { AdminService, AdminUserUpdate } from "@/services/AdminService";
import { User } from "@/types/user";

export interface NewAdminUser {
  username: string;
  password: string;
  email: string | null;
  is_admin: boolean;
}

/** User-administration state and mutations, kept outside render components. */
export function useAdminUsers() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await action();
    } catch (nextError) {
      setError(nextError);
      throw nextError;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(
    async () =>
      run(async () => {
        const nextUsers = await AdminService.listUsers();
        setUsers(nextUsers);
      }),
    [run],
  );

  const updateUser = useCallback(
    (userId: string, changes: AdminUserUpdate) =>
      run(async () => {
        await AdminService.updateUser(userId, changes);
        await loadUsers();
      }),
    [loadUsers, run],
  );

  return {
    users,
    loading,
    error,
    loadUsers,
    createUser: (user: NewAdminUser) =>
      run(async () => {
        await AdminService.createUser(user);
        await loadUsers();
      }),
    updateUser,
    scheduleDeletion: (userId: string) =>
      run(async () => {
        await AdminService.scheduleUserDeletion(userId);
        await loadUsers();
      }),
    cancelDeletion: (userId: string) =>
      run(async () => {
        await AdminService.cancelUserDeletion(userId);
        await loadUsers();
      }),
    resetPassword: (userId: string, password: string) =>
      run(() => AdminService.resetUserPassword(userId, password)),
    resetTotp: (userId: string) => run(() => AdminService.resetUserTotp(userId)),
  };
}
