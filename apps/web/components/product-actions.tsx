"use client";

import Link from "next/link";
import { useState } from "react";

import { addToCart, useCart } from "@/lib/cart-store";
import { ActionToast, type Notice } from "@/components/action-toast";
import type { Copy } from "@/lib/i18n";
import type { Language } from "@/lib/types";

const storages = [
	{ id: "256gb", label: "256 GB", delta: 0 },
	{ id: "512gb", label: "512 GB", delta: 8000 },
	{ id: "1tb", label: "1 TB", delta: 16000 },
];

const colors = [
	{ id: "deep-blue", nameTh: "ดีพบลู (Deep Blue)", nameEn: "Deep Blue", hex: "#183b67" },
	{ id: "natural", nameTh: "ไทเทเนียมธรรมชาติ", nameEn: "Natural Titanium", hex: "#8c877d" },
	{ id: "black", nameTh: "ไทเทเนียมดำ", nameEn: "Black Titanium", hex: "#2b2a28" },
	{ id: "white", nameTh: "ไทเทเนียมขาว", nameEn: "White Titanium", hex: "#e2e1dc" },
];

export function ProductActions({ productId, language, copy, basePrice = 48900 }: { productId: string; language: Language; copy: Copy; basePrice?: number }) {
	const cart = useCart();
	const [notice, setNotice] = useState<Notice | null>(null);
	const [selectedStorage, setSelectedStorage] = useState("256gb");
	const [selectedColor, setSelectedColor] = useState("deep-blue");
	const quantity = cart.find((item) => item.productId === productId)?.quantity ?? 0;

	const storageObj = storages.find((s) => s.id === selectedStorage) ?? storages[0]!;
	const colorObj = colors.find((c) => c.id === selectedColor) ?? colors[0]!;
	const currentPrice = basePrice + storageObj.delta;

	function add() {
		addToCart(productId);
		setNotice({ tone: "success", message: `${copy.commerce.addedToast} (${storageObj.label} · ${language === "th" ? colorObj.nameTh : colorObj.nameEn})` });
	}

	return (
		<div className="product-interactive-panel">
			<div className="selector-group">
				<span className="selector-label">{language === "th" ? "เลือกความจุ:" : "Select Capacity:"}</span>
				<div className="pill-group">
					{storages.map((s) => (
						<button
							key={s.id}
							type="button"
							className={`variant-pill ${selectedStorage === s.id ? "active" : ""}`}
							onClick={() => setSelectedStorage(s.id)}
						>
							<strong>{s.label}</strong>
							{s.delta > 0 ? <small>+{s.delta.toLocaleString()} ฿</small> : null}
						</button>
					))}
				</div>
			</div>

			<div className="selector-group">
				<span className="selector-label">{language === "th" ? "เลือกสีตัวเรือน:" : "Select Finish:"}</span>
				<div className="color-swatches">
					{colors.map((c) => (
						<button
							key={c.id}
							type="button"
							title={language === "th" ? c.nameTh : c.nameEn}
							className={`color-swatch-btn ${selectedColor === c.id ? "active" : ""}`}
							style={{ backgroundColor: c.hex }}
							onClick={() => setSelectedColor(c.id)}
							aria-label={c.nameEn}
						/>
					))}
					<span className="color-name-label">{language === "th" ? colorObj.nameTh : colorObj.nameEn}</span>
				</div>
			</div>

			<div className="live-price-summary">
				<strong>฿{currentPrice.toLocaleString()}</strong>
				<small>{copy.commerce.priceNote}</small>
			</div>

			<div className="product-actions">
				<button className="primary-button" type="button" onClick={add}>{quantity ? copy.commerce.addAnother : copy.commerce.add}<span aria-hidden="true">＋</span></button>
				<Link className="secondary-button" href={`/cart?lang=${language}`}>{copy.commerce.viewCart}{quantity ? ` · ${quantity}` : ""}</Link>
				<span className="product-action-status" aria-live="polite">{quantity ? copy.commerce.inCart.replace("{quantity}", String(quantity)) : ""}</span>
				<ActionToast notice={notice} onDismiss={() => setNotice(null)} dismissLabel={copy.commerce.dismiss} />
			</div>
		</div>
	);
}

