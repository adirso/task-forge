import { useEffect, useRef, useState } from "react";
import type { User } from "@taskforge/contracts";
import { Link2, MoreHorizontal, Pencil, Plus, Trash2, UsersRound } from "lucide-react";
import { Avatar } from "./Avatar";

export function ProjectHeaderActions({
  members,
  canManageProject,
  onOpenMembers,
  onCopyLink,
  onEdit,
  onDelete,
  onCreateTask,
}: {
  members: User[];
  canManageProject: boolean;
  onOpenMembers: () => void;
  onCopyLink: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onCreateTask: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handlePointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  function run(action: () => void) {
    setMenuOpen(false);
    action();
  }

  return (
    <>
      <button type="button" className="avatar-stack" onClick={onOpenMembers} aria-label="View project members">
        {members.slice(0, 3).map((member) => <Avatar key={member.id} user={member} size="sm" />)}
        {members.length > 3 && <span>+{members.length - 3}</span>}
      </button>
      <button type="button" className="button button-primary" onClick={onCreateTask}><Plus /> Create task</button>
      <div className="project-actions-menu" ref={menuRef}>
        <button
          type="button"
          className={`button button-secondary project-menu-trigger${menuOpen ? " open" : ""}`}
          aria-label="Project actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal />
        </button>
        {menuOpen && (
          <div className="project-actions-dropdown" role="menu">
            <button type="button" role="menuitem" onClick={() => run(onCopyLink)}><Link2 /> Copy link</button>
            <button type="button" role="menuitem" onClick={() => run(onOpenMembers)}><UsersRound /> Members</button>
            {canManageProject && (
              <>
                <button type="button" role="menuitem" onClick={() => run(onEdit)}><Pencil /> Edit</button>
                <button type="button" role="menuitem" className="danger" onClick={() => run(onDelete)}><Trash2 /> Delete</button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
