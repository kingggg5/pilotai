"use client";

import { useEffect, useState } from "react";
import { formatThb } from "@/lib/catalog";
import type { Language } from "@/lib/types";

const INITIAL_EXPIRY_SECONDS = 600; // 10 minutes

export function PromptPayModal({
	orderId,
	amount,
	language,
	onPaid,
	onClose,
}: {
	orderId: string;
	amount: number;
	language: Language;
	onPaid: () => void;
	onClose: () => void;
}) {
	const [timeLeft, setTimeLeft] = useState(INITIAL_EXPIRY_SECONDS);
	const [isExpired, setIsExpired] = useState(false);
	const [paying, setPaying] = useState(false);
	const [paidSuccess, setPaidSuccess] = useState(false);
	const [error, setError] = useState("");

	// Countdown timer effect
	useEffect(() => {
		if (paidSuccess || isExpired) return;
		const timer = setInterval(() => {
			setTimeLeft((prev) => {
				if (prev <= 1) {
					clearInterval(timer);
					setIsExpired(true);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
		return () => clearInterval(timer);
	}, [paidSuccess, isExpired]);

	const minutes = Math.floor(timeLeft / 60);
	const seconds = timeLeft % 60;
	const formattedTime = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	const progressPercent = (timeLeft / INITIAL_EXPIRY_SECONDS) * 100;

	function resetTimer() {
		setTimeLeft(INITIAL_EXPIRY_SECONDS);
		setIsExpired(false);
		setError("");
	}

	async function simulatePayment() {
		if (isExpired) return;
		setPaying(true);
		setError("");
		try {
			const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/pay`, {
				method: "POST",
			});
			const data = await res.json() as { ok?: boolean; message?: string };
			if (!res.ok || !data.ok) {
				throw new Error(data.message || (language === "th" ? "ไม่สามารถยืนยันการชำระเงินได้" : "Payment verification failed"));
			}
			setPaidSuccess(true);
			setTimeout(() => {
				onPaid();
			}, 1200);
		} catch (err) {
			setError(err instanceof Error ? err.message : (language === "th" ? "ชำระเงินไม่สำเร็จ" : "Payment failed"));
		} finally {
			setPaying(false);
		}
	}

	return (
		<div className="promptpay-overlay" role="dialog" aria-modal="true" aria-labelledby="promptpay-title">
			<div className="promptpay-theme-card">
				{/* Header with ServicePilot Theme */}
				<header className="promptpay-theme-header">
					<div className="promptpay-theme-brand">
						<div className="brand-title-row">
							<span className="brand-dot" aria-hidden="true">✳</span>
							<strong id="promptpay-title">พร้อมเพย์ · PromptPay</strong>
						</div>
						<span className="theme-subtag">Thai QR Payment · Real-time AI Settlement</span>
					</div>
					<button className="theme-close-btn" type="button" onClick={onClose} aria-label="Close">
						✕
					</button>
				</header>

				<div className="promptpay-theme-body">
					{/* Merchant & Order Details */}
					<div className="theme-merchant-info">
						<p className="merchant-name">ServicePilot Store Co., Ltd.</p>
						<div className="meta-pills">
							<span className="biller-pill">Biller ID: 010556701234500</span>
							<span className="ref-pill">Ref: {orderId}</span>
						</div>
					</div>

					{/* Timer Progress Bar */}
					{!paidSuccess && (
						<div className="expiry-timer-box" aria-live="polite">
							<div className="timer-label-row">
								<span className="timer-text">
									{isExpired
										? (language === "th" ? "⚠️ QR Code หมดอายุแล้ว" : "⚠️ QR Code Expired")
										: (language === "th" ? `⏱ กรุณาชำระเงินภายใน ${formattedTime} นาที` : `⏱ Pay within ${formattedTime} mins`)}
								</span>
								<span className="timer-badge">{formattedTime}</span>
							</div>
							<div className="timer-progress-track">
								<div
									className={`timer-progress-bar ${timeLeft < 120 ? "urgent" : ""}`}
									style={{ width: `${progressPercent}%` }}
								/>
							</div>
						</div>
					)}

					{/* QR Code Container */}
					<div className="theme-qr-container">
						{paidSuccess ? (
							<div className="theme-payment-success">
								<span className="success-icon">✓</span>
								<strong>{language === "th" ? "ชำระเงินสำเร็จแล้ว!" : "Payment Confirmed!"}</strong>
								<p>{language === "th" ? "ระบบ AI กำลังเตรียมจัดส่งพัสดุตามคำสั่งซื้อ" : "AI operations is preparing dispatch"}</p>
							</div>
						) : isExpired ? (
							<div className="theme-qr-expired">
								<span className="expired-icon">⏳</span>
								<strong>{language === "th" ? "หมดเวลาทำรายการ" : "Session Expired"}</strong>
								<p>{language === "th" ? "กรุณากดปุ่มเพื่อสร้าง QR Code ใหม่" : "Please refresh to generate a new QR Code"}</p>
								<button className="primary-button regenerate-btn" type="button" onClick={resetTimer}>
									{language === "th" ? "สร้าง QR Code ใหม่" : "Refresh QR Code"}
								</button>
							</div>
						) : (
							<div className="qr-canvas-wrapper">
								<svg
									className="promptpay-qr-svg"
									viewBox="0 0 240 240"
									fill="none"
									xmlns="http://www.w3.org/2000/svg"
								>
									{/* QR Background */}
									<rect width="240" height="240" rx="12" fill="#ffffff" />

									{/* Corner Finder Patterns */}
									{/* Top-Left */}
									<rect x="16" y="16" width="56" height="56" rx="8" stroke="#003d6b" strokeWidth="8" fill="none" />
									<rect x="28" y="28" width="32" height="32" rx="4" fill="#003d6b" />

									{/* Top-Right */}
									<rect x="168" y="16" width="56" height="56" rx="8" stroke="#003d6b" strokeWidth="8" fill="none" />
									<rect x="180" y="28" width="32" height="32" rx="4" fill="#003d6b" />

									{/* Bottom-Left */}
									<rect x="16" y="168" width="56" height="56" rx="8" stroke="#003d6b" strokeWidth="8" fill="none" />
									<rect x="28" y="180" width="32" height="32" rx="4" fill="#003d6b" />

									{/* Dynamic Data Matrix Blocks */}
									<g fill="#1a2b49">
										<rect x="84" y="20" width="10" height="10" />
										<rect x="100" y="20" width="10" height="10" />
										<rect x="120" y="20" width="10" height="10" />
										<rect x="144" y="20" width="10" height="10" />

										<rect x="84" y="36" width="10" height="10" />
										<rect x="110" y="36" width="10" height="10" />
										<rect x="134" y="36" width="10" height="10" />

										<rect x="84" y="52" width="10" height="10" />
										<rect x="100" y="52" width="10" height="10" />
										<rect x="124" y="52" width="10" height="10" />
										<rect x="144" y="52" width="10" height="10" />

										<rect x="20" y="84" width="10" height="10" />
										<rect x="44" y="84" width="10" height="10" />
										<rect x="68" y="84" width="10" height="10" />
										<rect x="94" y="84" width="10" height="10" />
										<rect x="134" y="84" width="10" height="10" />
										<rect x="164" y="84" width="10" height="10" />
										<rect x="188" y="84" width="10" height="10" />
										<rect x="210" y="84" width="10" height="10" />

										<rect x="36" y="100" width="10" height="10" />
										<rect x="60" y="100" width="10" height="10" />
										<rect x="174" y="100" width="10" height="10" />
										<rect x="198" y="100" width="10" height="10" />

										<rect x="20" y="116" width="10" height="10" />
										<rect x="44" y="116" width="10" height="10" />
										<rect x="74" y="116" width="10" height="10" />
										<rect x="164" y="116" width="10" height="10" />
										<rect x="210" y="116" width="10" height="10" />

										<rect x="36" y="132" width="10" height="10" />
										<rect x="60" y="132" width="10" height="10" />
										<rect x="174" y="132" width="10" height="10" />
										<rect x="198" y="132" width="10" height="10" />

										<rect x="20" y="148" width="10" height="10" />
										<rect x="50" y="148" width="10" height="10" />
										<rect x="74" y="148" width="10" height="10" />
										<rect x="164" y="148" width="10" height="10" />
										<rect x="188" y="148" width="10" height="10" />

										<rect x="84" y="168" width="10" height="10" />
										<rect x="110" y="168" width="10" height="10" />
										<rect x="134" y="168" width="10" height="10" />
										<rect x="168" y="168" width="10" height="10" />
										<rect x="198" y="168" width="10" height="10" />

										<rect x="94" y="188" width="10" height="10" />
										<rect x="120" y="188" width="10" height="10" />
										<rect x="144" y="188" width="10" height="10" />
										<rect x="178" y="188" width="10" height="10" />
										<rect x="208" y="188" width="10" height="10" />

										<rect x="84" y="208" width="10" height="10" />
										<rect x="104" y="208" width="10" height="10" />
										<rect x="130" y="208" width="10" height="10" />
										<rect x="154" y="208" width="10" height="10" />
										<rect x="188" y="208" width="10" height="10" />
									</g>

									{/* Center PromptPay Emblem */}
									<rect x="92" y="92" width="56" height="56" rx="8" fill="#003d6b" stroke="#ffffff" strokeWidth="4" />
									<text x="120" y="125" fill="#ffffff" fontSize="13" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">
										TH QR
									</text>
								</svg>
							</div>
						)}
					</div>

					{/* Amount Display in ServicePilot Theme */}
					<div className="theme-amount-card">
						<span className="theme-amount-label">{language === "th" ? "ยอดชำระเงินทั้งหมด" : "Total Settlement Amount"}</span>
						<strong className="theme-amount-value">{formatThb(amount, language)}</strong>
					</div>

					{error && <p className="theme-payment-error" role="alert">{error}</p>}
				</div>

				{/* Footer Actions in ServicePilot Theme */}
				<footer className="promptpay-theme-footer">
					{!isExpired && (
						<button
							className="primary-button theme-pay-btn"
							type="button"
							onClick={simulatePayment}
							disabled={paying || paidSuccess}
						>
							{paying ? (
								<span>{language === "th" ? "กำลังตรวจสอบการชำระเงิน…" : "Verifying Payment…"}</span>
							) : paidSuccess ? (
								<span>{language === "th" ? "ชำระเงินสำเร็จ ✓" : "Paid Successfully ✓"}</span>
							) : (
								<span>{language === "th" ? "จำลองสแกนชำระเงินสำเร็จ (Simulate Pay)" : "Simulate Instant Payment"}</span>
							)}
						</button>
					)}
					<button className="text-button theme-cancel-btn" type="button" onClick={onClose} disabled={paying}>
						{language === "th" ? "ปิดหน้าต่าง / ไว้ชำระภายหลัง" : "Close / Pay Later"}
					</button>
				</footer>
			</div>
		</div>
	);
}
