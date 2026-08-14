"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { postJson } from "@/lib/browser-api";
import { localizedPath } from "@/lib/customer-return";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function CustomerAuthForm({ mode, language, copy, nextPath = "/account" }: { mode: "login" | "register"; language: Language; copy: Copy; nextPath?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false); const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      await postJson("/api/customer/session", { mode, name: form.get("name"), email: form.get("email"), phone: form.get("phone"), password: form.get("password") });
      router.replace(localizedPath(nextPath, language)); router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : copy.account.authError); }
    finally { setPending(false); }
  }
  const nextQuery = nextPath === "/account" ? "" : `&next=${encodeURIComponent(nextPath)}`;
  return <section className="account-auth-card"><div className="auth-tabs"><Link aria-current={mode === "login" ? "page" : undefined} href={`/account/login?lang=${language}${nextQuery}`}>{copy.account.signIn}</Link><Link aria-current={mode === "register" ? "page" : undefined} href={`/account/register?lang=${language}${nextQuery}`}>{copy.account.register}</Link></div><h1>{mode === "login" ? copy.account.signIn : copy.account.register}</h1><p>{copy.account.subtitle}</p><form onSubmit={submit}>{mode === "register" ? <label><span>{copy.account.name}</span><input name="name" required minLength={2} maxLength={120} autoComplete="name" /></label> : null}<label><span>{copy.account.email}</span><input name="email" required type="email" maxLength={240} autoComplete="email" /></label>{mode === "register" ? <label><span>{copy.account.phone}</span><input name="phone" required type="tel" minLength={7} maxLength={32} autoComplete="tel" /></label> : null}<label><span>{copy.account.password}</span><input name="password" required type="password" minLength={mode === "register" ? 10 : 1} maxLength={128} autoComplete={mode === "register" ? "new-password" : "current-password"} />{mode === "register" ? <small>{copy.account.passwordHint}</small> : null}</label>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="primary-button" disabled={pending} type="submit">{pending ? copy.account.working : mode === "login" ? copy.account.submitLogin : copy.account.submitRegister}</button></form></section>;
}
