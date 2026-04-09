"use client";

import { Suspense, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import styles from "./page.module.scss";

// Split out the part that uses useSearchParams so it can be wrapped in Suspense
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Login failed.");
        return;
      }

      router.replace(from);
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.field}>
        <label className={styles.label} htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className={styles.input}
          type="text"
          autoComplete="username"
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
          required
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className={styles.input}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          required
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <button className={styles.submit} type="submit" disabled={loading}>
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.brand}>
          <div className={styles.logo}>
            <img src="/nwg_icon.svg" alt="NWG" width={40} height={40} />
          </div>
          <div className={styles.brandText}>
            <span className={styles.brandName}>NWG Atlas</span>
            <span className={styles.brandSub}>New World Group</span>
          </div>
        </div>

        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.sub}>Internal access only</p>

        <Suspense fallback={<div className={styles.sub}>Loading…</div>}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
