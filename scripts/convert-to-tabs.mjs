import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = [
	"apps/api/src",
	"apps/api/tests",
	"apps/web/app",
	"apps/web/components",
	"apps/web/lib",
	"apps/web/tests",
	"evals",
	"scripts",
].map((target) => path.join(root, target));
const targetFiles = [
	"apps/web/next.config.ts",
	"apps/web/eslint.config.mjs",
	"apps/web/postcss.config.mjs",
].map((target) => path.join(root, target));

function spacesToTabs(content) {
	return content.split("\n").map((line) => {
		const match = line.match(/^( +)/);
		if (!match) return line;

		const spaces = match[1].length;
		return "\t".repeat(Math.floor(spaces / 2)) + " ".repeat(spaces % 2) + line.slice(spaces);
	}).join("\n");
}

async function processDir(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	for (const entry of entries) {
		const file = path.join(directory, entry.name);
		if (entry.isDirectory()) await processDir(file);
		else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) await processFile(file);
	}
}

async function processFile(file) {
	const content = await readFile(file, "utf8");
	const converted = spacesToTabs(content);
	if (converted !== content) await writeFile(file, converted, "utf8");
}

await Promise.all([...targets.map(processDir), ...targetFiles.map(async (file) => {
	if ((await stat(file)).isFile()) await processFile(file);
})]);
