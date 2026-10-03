import { Avatar } from "../../../../components/Avatar";
import type { AccountSectionProps } from "./types";
import styles from "./AccountSection.module.css";

export function AccountSection({ user, name, email, onNameChange, onEmailChange, onSubmit }: AccountSectionProps) {
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        <h2>Account details</h2>
        <p>These details identify you to project members and agents.</p>
      </div>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.summary}>
          <Avatar user={user} size="lg" />
          <span><strong>{user.name}</strong><small>{user.role.toLowerCase()} · human account</small></span>
        </div>
        <label>Full name<input value={name} onChange={(event) => onNameChange(event.target.value)} required /></label>
        <label>Email address<input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} required /></label>
        <div><button type="submit" className="button button-primary">Save changes</button></div>
      </form>
    </div>
  );
}
