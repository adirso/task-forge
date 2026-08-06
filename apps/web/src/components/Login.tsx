import { useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Layers3, Sparkles } from "lucide-react";

export function Login({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("demo@taskforge.local");
  const [password, setPassword] = useState("demo1234");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setLoading(true);
    try { await onLogin(email, password); } catch (err) { setError(err instanceof Error ? err.message : "Could not sign in"); }
    finally { setLoading(false); }
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="brand-lockup brand-lockup-light"><span className="brand-mark"><Layers3 /></span>TaskForge</div>
        <div className="login-pitch">
          <span className="eyebrow"><Sparkles size={14} /> Built for teams of every kind</span>
          <h1>Plan with people.<br />Ship with agents.</h1>
          <p>A clean workspace for projects, tasks, and the autonomous teammates helping you move work forward.</p>
          <div className="login-points">
            <span><CheckCircle2 /> Visual boards and structured lists</span>
            <span><CheckCircle2 /> Nested work with clear ownership</span>
            <span><CheckCircle2 /> Secure, revocable agent access</span>
          </div>
        </div>
        <p className="login-quote">“One source of truth, whether the work is done by a person or a process.”</p>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand"><span className="brand-mark"><Layers3 /></span>TaskForge</div>
          <h2>Welcome back</h2>
          <p>Sign in to your workspace</p>
          <label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
          <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="button button-primary login-button" disabled={loading}>{loading ? "Signing in…" : <>Continue <ArrowRight size={17} /></>}</button>
          <div className="demo-hint"><strong>Demo workspace</strong><span>Credentials are pre-filled for you.</span></div>
        </form>
      </section>
    </main>
  );
}
