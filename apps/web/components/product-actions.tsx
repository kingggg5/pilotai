"use client";

import Link from "next/link";
import { useState } from "react";

import { addToCart, useCart } from "@/lib/cart-store";
import { ActionToast, type Notice } from "@/components/action-toast";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function ProductActions({ productId, language, copy }: { productId: string; language: Language; copy: Copy }) {
  const cart = useCart();
  const [notice, setNotice] = useState<Notice | null>(null);
  const quantity = cart.find((item) => item.productId === productId)?.quantity ?? 0;

  function add() {
    addToCart(productId);
    setNotice({ tone: "success", message: copy.commerce.addedToast });
  }

  return (
    <div className="product-actions">
      <button className="primary-button" type="button" onClick={add}>{quantity ? copy.commerce.addAnother : copy.commerce.add}<span aria-hidden="true">＋</span></button>
      <Link className="secondary-button" href={`/cart?lang=${language}`}>{copy.commerce.viewCart}{quantity ? ` · ${quantity}` : ""}</Link>
      <span className="product-action-status" aria-live="polite">{quantity ? copy.commerce.inCart.replace("{quantity}", String(quantity)) : ""}</span>
      <ActionToast notice={notice} onDismiss={() => setNotice(null)} dismissLabel={copy.commerce.dismiss} />
    </div>
  );
}
