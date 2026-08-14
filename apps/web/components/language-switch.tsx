"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { Language } from "@/lib/types";

export function LanguageSwitch({ language, path, label }: { language: Language; path: string; label: string }) {
  const pathname = usePathname() || path;
  const current = useSearchParams();
  const href = (next: Language) => {
    const query = new URLSearchParams(current.toString());
    query.set("lang", next);
    return `${pathname}?${query}`;
  };
  const remember = (next: Language) => { document.cookie = `sp_lang=${next}; Max-Age=31536000; Path=/; SameSite=Lax`; };

  return (
    <nav className="language-switch" aria-label={label}>
      <Link href={href("th")} onClick={() => remember("th")} aria-current={language === "th" ? "page" : undefined}>ไทย</Link>
      <Link href={href("en")} onClick={() => remember("en")} aria-current={language === "en" ? "page" : undefined}>EN</Link>
    </nav>
  );
}
