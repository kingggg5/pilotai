import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "..");
export async function jsonLines<T>(path: string): Promise<T[]> { return (await readFile(path, "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as T); }
export function option(name: string, fallback?: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; }
export async function output(report: unknown, path?: string) { const rendered = `${JSON.stringify(report, null, 2)}\n`; process.stdout.write(rendered); if (path) await writeFile(path, rendered, "utf8"); }
