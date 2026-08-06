import type { User } from "@taskforge/contracts";
import { LogOut, X } from "lucide-react";
import { Avatar } from "./Avatar";

export function LogoutConfirmModal({ user, onClose, onConfirm }: { user: User; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="logout-modal" role="dialog" aria-modal="true" aria-labelledby="logout-title">
        <header>
          <span className="logout-icon"><LogOut /></span>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close logout confirmation"><X /></button>
        </header>
        <h2 id="logout-title">Log out of TaskForge?</h2>
        <p>You’ll need to sign in again to access your workspace.</p>
        <div className="logout-user-summary"><Avatar user={user} /><span><strong>{user.name}</strong><small>{user.email}</small></span></div>
        <footer>
          <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="button button-delete" onClick={onConfirm}><LogOut /> Log out</button>
        </footer>
      </section>
    </div>
  );
}
