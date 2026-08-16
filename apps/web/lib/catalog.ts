export type Product = {
	id: string;
	name: string;
	variant: string;
	priceThb: number;
	sourceUrl: string;
	imageUrl: string;
};

export function formatThb(value: number, language: "th" | "en") {
	return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", {
		style: "currency",
		currency: "THB",
		maximumFractionDigits: 0,
	}).format(value);
}
