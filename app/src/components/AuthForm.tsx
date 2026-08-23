"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const supabase = createSupabaseBrowserClient();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
        if (data.session) {
          router.push(next);
          router.refresh();
        } else {
          setInfo(
            "確認メールを送信しました。メール内のリンクを開くと登録が完了します。"
          );
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push(next);
        router.refresh();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(
        message.includes("Invalid login credentials")
          ? "メールアドレスまたはパスワードが違います。"
          : message.includes("already registered")
            ? "このメールアドレスは登録済みです。ログインしてください。"
            : message
      );
    } finally {
      setBusy(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="auth-box">
      <h1>{mode === "login" ? "ログイン" : "会員登録（無料）"}</h1>

      <button type="button" className="btn btn--google" onClick={signInWithGoogle}>
        Googleで{mode === "login" ? "ログイン" : "登録"}
      </button>
      <div className="divider">または</div>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="email">メールアドレス</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="mail@example.com"
          />
        </div>
        <div className="field">
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="8文字以上"
          />
        </div>

        {error && <p className="form-error">{error}</p>}
        {info && <p className="form-note">{info}</p>}

        <button className="btn btn--block" type="submit" disabled={busy}>
          {busy ? "送信中…" : mode === "login" ? "ログイン" : "登録する"}
        </button>
      </form>

      <p className="form-note">
        {mode === "login" ? (
          <>
            はじめての方は <a href="/signup">会員登録（無料）</a>
          </>
        ) : (
          <>
            登録済みの方は <a href="/login">ログイン</a>
            <br />
            ※決済時に使うメールアドレスと同じものでご登録ください。視聴権限はメールアドレスで照合されます。
          </>
        )}
      </p>
    </div>
  );
}
