"use client";

import { useState } from "react";
import { Plus, Pencil, Archive, RotateCcw, Check, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

export interface EditableItem {
  id: string;
  name: string;
  is_active: boolean;
}

export function EditableList({
  items,
  addPlaceholder,
  onAdd,
  onRename,
  onToggleActive,
  archiveNoun = "פריט",
}: {
  items: EditableItem[];
  addPlaceholder: string;
  onAdd: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onToggleActive: (id: string, active: boolean) => Promise<void>;
  archiveNoun?: string;
}) {
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      await onAdd(newName.trim());
      setNewName("");
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(id: string) {
    if (!editValue.trim()) return;
    await onRename(id, editValue.trim());
    setEditingId(null);
  }

  const archiveTarget = items.find((i) => i.id === confirmArchiveId);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={addPlaceholder}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        />
        <Button onClick={handleAdd} loading={adding}>
          <Plus className="h-4 w-4" /> הוספה
        </Button>
      </div>

      <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
        {items.length === 0 && <p className="p-4 text-sm text-ink-400">אין פריטים עדיין</p>}
        {items.map((item) => (
          <div key={item.id} className={`flex items-center gap-2 p-3 ${!item.is_active ? "bg-ink-50/60" : ""}`}>
            {editingId === item.id ? (
              <>
                <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="flex-1 py-1.5" autoFocus />
                <button onClick={() => handleRename(item.id)} className="rounded-lg bg-success-50 p-2 text-success-600">
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => setEditingId(null)} className="rounded-lg bg-ink-100 p-2 text-ink-500">
                  <X className="h-4 w-4" />
                </button>
              </>
            ) : (
              <>
                <span className={`flex-1 text-sm font-semibold ${item.is_active ? "text-ink-800" : "text-ink-400 line-through"}`}>
                  {item.name}
                </span>
                {!item.is_active && <span className="badge bg-ink-100 text-ink-500">בארכיון</span>}
                <button
                  onClick={() => {
                    setEditingId(item.id);
                    setEditValue(item.name);
                  }}
                  className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setConfirmArchiveId(item.id)}
                  className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                >
                  {item.is_active ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!confirmArchiveId}
        onClose={() => setConfirmArchiveId(null)}
        onConfirm={async () => {
          if (archiveTarget) await onToggleActive(archiveTarget.id, !archiveTarget.is_active);
          setConfirmArchiveId(null);
        }}
        title={archiveTarget?.is_active ? `להעביר את "${archiveTarget?.name}" לארכיון?` : `להחזיר את "${archiveTarget?.name}" לפעיל?`}
        description={`לא נמחק מידע קיים — ${archiveNoun} יוסתר מרשימות בחירה חדשות בלבד.`}
        confirmLabel={archiveTarget?.is_active ? "העברה לארכיון" : "החזרה לפעיל"}
        danger={!!archiveTarget?.is_active}
      />
    </div>
  );
}
