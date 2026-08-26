import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Project, ProjectMember, User } from "@taskforge/contracts";
import { ShieldCheck, Trash2, UserPlus, UsersRound, X } from "lucide-react";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";

export function ProjectMembersModal({
  project,
  users,
  currentUser,
  onClose,
  onChanged,
}: {
  project: Project;
  users: User[];
  currentUser: User;
  onClose: () => void;
  onChanged: (project: Project) => void;
}) {
  const [roster, setRoster] = useState<Project>(project);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const members = roster.members ?? [];
  const canManage = currentUser.role === "ADMIN" || roster.ownerId === currentUser.id;
  const availableUsers = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.id));
    return users.filter((candidate) => !memberIds.has(candidate.id));
  }, [members, users]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.project(project.id)
      .then(({ project: fresh }) => { if (!cancelled) setRoster(fresh); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load project members"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    if (!availableUsers.some((candidate) => candidate.id === selectedMemberId)) {
      setSelectedMemberId(availableUsers[0]?.id ?? "");
    }
  }, [availableUsers, selectedMemberId]);

  function success(text: string) {
    setMessage(text);
    setError("");
    window.setTimeout(() => setMessage(""), 2200);
  }

  async function refresh() {
    const { project: fresh } = await api.project(project.id);
    setRoster(fresh);
    onChanged(fresh);
    return fresh;
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!selectedMemberId || !canManage) return;
    setBusy(true);
    setError("");
    try {
      await api.addProjectMember(project.id, selectedMemberId);
      await refresh();
      success("Member added");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add project member");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: ProjectMember) {
    if (!canManage || member.id === roster.ownerId) return;
    if (!window.confirm(`Remove ${member.name} from ${roster.name}? Their assigned tasks will become unassigned.`)) return;
    setBusy(true);
    setError("");
    try {
      await api.removeProjectMember(project.id, member.id);
      await refresh();
      success("Member removed");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove project member");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div className="project-modal members-modal" role="dialog" aria-modal="true" aria-labelledby="members-modal-title">
        <header>
          <div className="modal-header-copy">
            <span className="modal-kicker">Project access</span>
            <h2 id="members-modal-title">Members & agents</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Close"><X /></button>
        </header>
        <div className="modal-body">
          <p>Manage which people and agents can access {roster.name}.</p>

          {loading ? (
            <div className="members-loading">Loading project members…</div>
          ) : (
            <div className="project-member-manager members-modal-body">
              {canManage ? (
                <form className="add-member-form" onSubmit={addMember}>
                  <label>
                    Add a person or agent
                    <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)} disabled={!availableUsers.length || busy}>
                      {availableUsers.length
                        ? availableUsers.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} · {candidate.kind === "AGENT" ? "Agent" : "Human"}
                          </option>
                        ))
                        : <option value="">{users.length ? "Everyone is already a member" : "No people or agents available to add"}</option>}
                    </select>
                  </label>
                  <button className="button button-primary" disabled={!selectedMemberId || busy}><UserPlus /> Add member</button>
                </form>
              ) : (
                <div className="settings-notice">
                  <ShieldCheck />
                  <span>
                    <strong>Project owner access required</strong>
                    <small>You can view this roster, but only the owner or an administrator can change it.</small>
                  </span>
                </div>
              )}

              <div className="project-member-list">
                <div className="member-list-heading">
                  <h3>People with access</h3>
                  <span>{members.length} {members.length === 1 ? "member" : "members"}</span>
                </div>
                {members.length ? members.map((member) => (
                  <article key={member.id}>
                    <Avatar user={member} size="md" />
                    <span>
                      <strong>{member.name}</strong>
                      <small>{member.email} · {member.kind === "AGENT" ? "Agent" : "Human"}</small>
                    </span>
                    <em className={member.projectRole === "OWNER" ? "owner" : ""}>{member.projectRole === "OWNER" ? "Owner" : "Member"}</em>
                    {canManage && member.id !== roster.ownerId
                      ? <button type="button" className="remove-member" onClick={() => removeMember(member)} title={`Remove ${member.name}`} disabled={busy}><Trash2 /></button>
                      : <span className="member-action-placeholder" />}
                  </article>
                )) : (
                  <div className="select-agent-empty"><UsersRound /><span>No members on this project yet.</span></div>
                )}
              </div>
            </div>
          )}

          {error && <div className="form-error">{error}</div>}
          {message && <div className="form-success">{message}</div>}
        </div>
        <footer>
          <span />
          <div>
            <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Close</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
