import { useState } from "react";

export interface ContentItem {
  id: string;
}

interface UseContentManagerProps<T extends ContentItem> {
  getItems: (memberId: string) => T[];
  removeItem: (id: string) => Promise<void>;
  memberId: string;
}

export function useContentManager<T extends ContentItem>({
  getItems,
  removeItem,
  memberId,
}: UseContentManagerProps<T>) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<T | null>(null);
  const [itemToDelete, setItemToDelete] = useState<T | null>(null);

  const items = getItems(memberId);

  const handleAdd = () => {
    setEditingItem(null);
    setIsDialogOpen(true);
  };

  const handleEdit = (item: T) => {
    setEditingItem(item);
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (itemToDelete) {
      await removeItem(itemToDelete.id);
      setItemToDelete(null);
    }
  };

  const openDeleteDialog = (item: T) => {
    setItemToDelete(item);
  };

  const closeDeleteDialog = () => {
    setItemToDelete(null);
  };

  return {
    items,
    isDialogOpen,
    setIsDialogOpen,
    editingItem,
    itemToDelete,
    handleAdd,
    handleEdit,
    handleDelete,
    openDeleteDialog,
    closeDeleteDialog,
  };
}
