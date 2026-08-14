"use client";

import Link from "next/link";

import { useCart } from "@/lib/cart-store";
import type { Language } from "@/lib/types";

export function CartLink({ language, label, current }: { language: Language; label: string; current: boolean }) {
  const count = useCart().reduce((total, line) => total + line.quantity, 0);

  return (
    <Link className="route-link cart-link" aria-current={current ? "page" : undefined} aria-label={count ? `${label} (${count})` : undefined} href={`/cart?lang=${language}`}>
      {label}{count ? <span className="cart-count" aria-hidden="true">{count}</span> : null}
    </Link>
  );
}
