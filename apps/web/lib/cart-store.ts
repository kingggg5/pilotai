"use client";

import { useSyncExternalStore } from "react";

export type CartLine = { productId: string; quantity: number };

const KEY = "servicepilot-cart-v1";
const EVENT = "servicepilot:cart";
const EMPTY: CartLine[] = [];
let cachedRaw = "";
let cachedCart = EMPTY;

function parseCart(raw: string): CartLine[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return EMPTY;
    return value.flatMap((line) => {
      if (!line || typeof line !== "object") return [];
      const { productId, quantity } = line as Partial<CartLine>;
      return typeof productId === "string" && Number.isInteger(quantity) && Number(quantity) > 0
        ? [{ productId, quantity: Math.min(Number(quantity), 10) }]
        : [];
    });
  } catch {
    return EMPTY;
  }
}

function snapshot() {
  const raw = localStorage.getItem(KEY) || "[]";
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedCart = parseCart(raw);
  }
  return cachedCart;
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function save(lines: CartLine[]) {
  localStorage.setItem(KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event(EVENT));
}

export function useCart() {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export function setCartQuantity(productId: string, quantity: number) {
  const current = snapshot().filter((line) => line.productId !== productId);
  if (quantity > 0) current.push({ productId, quantity: Math.min(quantity, 10) });
  save(current);
}

export function addToCart(productId: string) {
  const current = snapshot();
  const line = current.find((item) => item.productId === productId);
  setCartQuantity(productId, (line?.quantity || 0) + 1);
}

export function clearCart() {
  save(EMPTY);
}
