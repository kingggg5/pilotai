"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ActionToast, type Notice } from "@/components/action-toast";
import { clearCart, setCartQuantity, useCart } from "@/lib/cart-store";
import { formatThb, type Product } from "@/lib/catalog";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";

export function CartView({ language, copy, signedIn, products }: { language: Language; copy: Copy; signedIn: boolean; products: Product[] }) {
  const router = useRouter();
  const cart = useCart();
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const lines = cart.flatMap((line) => {
    const product = products.find((item) => item.id === line.productId);
    return product ? [{ ...line, product }] : [];
  });
  const total = lines.reduce((sum, line) => sum + line.product.priceThb * line.quantity, 0);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  async function buy() {
    if (!signedIn) {
      setNotice({ tone: "info", message: copy.commerce.signInToBuy });
      router.push(`/account/login?lang=${language}&next=%2Fcart`);
      return;
    }
    setBuying(true);
    setNotice(null);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: language,
          items: lines.map(({ product, quantity }) => ({ productId: product.id, quantity }))
        })
      });
      const payload = await response.json() as { ok?: boolean; purchase?: { orderId: string }; message?: string };
      if (!response.ok || !payload.purchase) {
        if (response.status === 401) {
          setNotice({ tone: "info", message: copy.commerce.signInToBuy });
          router.push(`/account/login?lang=${language}&next=%2Fcart`);
          return;
        }
        throw new Error(payload.message || copy.commerce.buyError);
      }
      setOrderId(payload.purchase.orderId);
      clearCart();
      setNotice({ tone: "success", message: copy.commerce.buySuccess.replace("{orderId}", payload.purchase.orderId) });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : copy.commerce.buyError;
      setNotice({ tone: "error", message });
    } finally {
      setBuying(false);
    }
  }

  if (!lines.length) {
    return (
      <>
        {orderId ? <section className="purchase-success" aria-live="polite"><span aria-hidden="true">✓</span><div><strong>{copy.commerce.buySuccess.replace("{orderId}", orderId)}</strong><p>{copy.commerce.orderMessage}</p></div></section> : null}
        <section className="cart-empty">
          <div className="empty-device" aria-hidden="true">＋</div>
          <h1>{copy.commerce.empty}</h1>
          <Link className="primary-button" href={`/?lang=${language}`}>{copy.commerce.continueShopping}<span aria-hidden="true">→</span></Link>
        </section>
        <ActionToast notice={notice} onDismiss={() => setNotice(null)} dismissLabel={copy.commerce.dismiss} />
      </>
    );
  }

  return (
    <div className="cart-layout">
      <section className="cart-items" aria-labelledby="cart-title">
        <div className="cart-heading"><div><h1 id="cart-title">{copy.commerce.cartTitle}</h1><p>{copy.commerce.cartSubtitle}</p></div><span>{itemCount} {itemCount === 1 ? copy.commerce.item : copy.commerce.items}</span></div>
        {lines.map(({ product, quantity }) => (
          <article className="cart-line" key={product.id}>
            <div className="cart-product-mark">
              <Image src={product.imageUrl} alt={`${product.name} ${product.variant}`} width={160} height={120} sizes="160px" />
            </div>
            <div className="cart-product-copy">
              <h2>{product.name}</h2>
              <p>{product.variant}</p>
              <strong>{formatThb(product.priceThb, language)}</strong>
            </div>
            <div className="cart-controls-group">
              <label className="cart-qty-label">
                <span>{copy.commerce.quantity}</span>
                <select value={quantity} onChange={(event) => { setCartQuantity(product.id, Number(event.target.value)); setNotice({ tone: "success", message: copy.commerce.cartUpdated }); }}>
                  {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <button className="remove-button" type="button" onClick={() => { setCartQuantity(product.id, 0); setNotice({ tone: "success", message: copy.commerce.itemRemoved }); }}>
                {copy.commerce.remove}
              </button>
            </div>
          </article>
        ))}
        <div className="cart-list-actions">
          <Link className="secondary-button" href={`/?lang=${language}`}>← {copy.commerce.continueShopping}</Link>
          <button className="secondary-button" type="button" onClick={() => { clearCart(); setNotice({ tone: "success", message: copy.commerce.cartCleared }); }}>{copy.commerce.clear}</button>
        </div>
      </section>
      <aside className="cart-summary">
        <div><span>{copy.commerce.subtotal}</span><strong>{formatThb(total, language)}</strong></div>
        <ol className="cart-order-steps">{copy.commerce.orderSteps.map((step, index) => <li key={step}><span>{index + 1}</span>{step}</li>)}</ol>
        <button className="primary-button" type="button" onClick={buy} disabled={buying}>{buying ? copy.commerce.buying : copy.commerce.requestOrder}<span aria-hidden="true">→</span></button>
      </aside>
      <ActionToast notice={notice} onDismiss={() => setNotice(null)} dismissLabel={copy.commerce.dismiss} />
    </div>
  );
}
