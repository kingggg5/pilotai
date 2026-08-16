"use client";

import { useRouter } from "next/navigation";

export function AdminLogout({ label, language }: { label: string; language: string }) {
	const router = useRouter();
	return <button className="text-button" type="button" onClick={async () => {
		await fetch("/api/admin/session", { method: "DELETE" });
		router.replace(`/admin/login?lang=${language}`);
		router.refresh();
	}}>{label}</button>;
}
