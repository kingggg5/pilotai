import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const severities = ["low", "medium", "high", "critical"];
const penalties = { critical: 25, high: 15, medium: 5, low: 1 };
const textExtensions = new Set([
	".cjs", ".conf", ".css", ".env", ".html", ".js", ".json", ".jsx", ".md",
	".mjs", ".ps1", ".sql", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const excludedDirectories = new Set([
	".git", ".impeccable", ".next", ".secrets", "backups", "coverage", "dist",
	"node_modules", "work",
]);
const selfFiles = new Set([
	"scripts/quality/vibe-check.mjs",
	"scripts/quality/vibe-check.test.mjs",
]);
const localOnlyFiles = new Set([".env.local", ".env.production"]);

const lineRules = [
	{
		id: "P1-SECRET-TOKEN",
		priority: "P1 Security",
		severity: "critical",
		title: "A credential-shaped token is present in source control",
		pattern: /(?:\bsk-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[0-9A-Z]{16}\b)/,
		redact: true,
	},
	{
		id: "P1-PRIVATE-KEY",
		priority: "P1 Security",
		severity: "critical",
		title: "A private key is present in source control",
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
		redact: true,
	},
	{
		id: "P1-DYNAMIC-CODE",
		priority: "P1 Security",
		severity: "high",
		title: "Dynamic code execution can allow code injection",
		pattern: /(?<![\w.])eval\s*\(|\bnew\s+Function\s*\(/,
	},
	{
		id: "P1-UNSAFE-HTML",
		priority: "P1 Security",
		severity: "high",
		title: "Raw HTML rendering needs an explicit sanitization boundary",
		pattern: /dangerouslySetInnerHTML\s*=/,
	},
	{
		id: "P1-TLS-BYPASS",
		priority: "P1 Security",
		severity: "critical",
		title: "TLS certificate validation is disabled",
		pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|rejectUnauthorized\s*:\s*false/,
	},
	{
		id: "P2-SKIPPED-TEST",
		priority: "P2 Bugs & Performance",
		severity: "high",
		title: "A committed test is disabled",
		pattern: /\b(?:describe|it|test)\.skip\s*\(|\b(?:xdescribe|xit|xtest)\s*\(/,
	},
	{
		id: "P2-INSECURE-RANDOM",
		priority: "P2 Bugs & Performance",
		severity: "high",
		title: "Math.random must not generate authentication or security values",
		pattern: /Math\.random\s*\(/,
		appliesTo: (file) => /(?:auth|security|session|token|password)/i.test(file),
	},
	{
		id: "P2-CONSOLE-OUTPUT",
		priority: "P2 Bugs & Performance",
		severity: "medium",
		title: "Production code should use structured logging",
		pattern: /console\.(?:log|debug)\s*\(/,
		appliesTo: (file) => /^(?:apps\/api\/src|apps\/web\/(?:app|components|lib))\//.test(file),
	},
	{
		id: "P3-TYPE-SUPPRESSION",
		priority: "P3 Code Quality",
		severity: "medium",
		title: "Type or lint suppression requires a documented reason",
		pattern: /@ts-(?:ignore|nocheck)|eslint-disable(?:-next-line|-line)?(?:\s|$)/,
	},
	{
		id: "P3-FOLLOW-UP",
		priority: "P3 Code Quality",
		severity: "low",
		title: "A TODO or FIXME remains in maintained code",
		pattern: /\b(?:TODO|FIXME)\b/,
		appliesTo: (file) => !/^(?:README\.md|docs\/)/.test(file),
	},
];

function normalize(file) {
	return file.split(path.sep).join("/");
}

function isTextFile(file) {
	const name = path.basename(file);
	return textExtensions.has(path.extname(file).toLowerCase()) || name === "Dockerfile" || name.startsWith(".env.");
}

async function collectFiles(root, directory = root) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		if (entry.isSymbolicLink()) continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (!excludedDirectories.has(entry.name)) files.push(...await collectFiles(root, absolute));
		} else if (entry.isFile() && isTextFile(absolute)) {
			const relative = normalize(path.relative(root, absolute));
			if (!localOnlyFiles.has(relative)) files.push(absolute);
		}
	}

	return files;
}

export function analyzeFile(file, content) {
	const normalizedFile = normalize(file);
	if (selfFiles.has(normalizedFile)) return [];

	const findings = [];
	const lines = content.split(/\r?\n/);

	lines.forEach((line, index) => {
		for (const rule of lineRules) {
			if (rule.appliesTo && !rule.appliesTo(normalizedFile)) continue;
			if (!rule.pattern.test(line)) continue;
			findings.push({
				id: rule.id,
				priority: rule.priority,
				severity: rule.severity,
				title: rule.title,
				file: normalizedFile,
				line: index + 1,
				evidence: rule.redact ? "[redacted]" : line.trim().slice(0, 160),
			});
		}
	});

	if (/\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(normalizedFile) && lines.length > 500) {
		findings.push({
			id: "P3-LARGE-MODULE",
			priority: "P3 Code Quality",
			severity: "medium",
			title: "Module exceeds 500 lines and should be reviewed for cohesion",
			file: normalizedFile,
			line: 1,
			evidence: `${lines.length} lines`,
		});
	}

	return findings;
}

export function scoreFindings(findings) {
	const penalty = findings.reduce((total, finding) => total + penalties[finding.severity], 0);
	return Math.max(0, 100 - penalty);
}

export function buildReport(filesScanned, findings) {
	const counts = Object.fromEntries(severities.map((severity) => [severity, 0]));
	for (const finding of findings) counts[finding.severity] += 1;
	return {
		schemaVersion: 1,
		score: scoreFindings(findings),
		filesScanned,
		findings: findings.length,
		counts,
		results: findings,
	};
}

export async function scanRepository(root) {
	const files = (await collectFiles(root)).sort();
	const findings = [];

	for (const absolute of files) {
		const relative = normalize(path.relative(root, absolute));
		const content = await readFile(absolute, "utf8");
		findings.push(...analyzeFile(relative, content));
	}

	return buildReport(files.length, findings);
}

function parseArgs(args) {
	const options = { root: undefined, json: undefined, failOn: "high" };
	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];
		if (value === "--root") options.root = args[++index];
		else if (value === "--json") options.json = args[++index];
		else if (value === "--fail-on") options.failOn = args[++index]?.toLowerCase();
		else if (value === "--help") options.help = true;
		else throw new Error(`Unknown option: ${value}`);
	}
	if (![...severities, "none"].includes(options.failOn)) throw new Error("--fail-on must be critical, high, medium, low, or none");
	return options;
}

function printReport(report) {
	console.log(`ServicePilot quality score: ${report.score}/100`);
	console.log(`Scanned ${report.filesScanned} files; found ${report.findings} issue(s).`);
	console.log(`Critical ${report.counts.critical} | High ${report.counts.high} | Medium ${report.counts.medium} | Low ${report.counts.low}`);
	for (const finding of report.results) {
		console.log(`[${finding.severity.toUpperCase()}] ${finding.id} ${finding.file}:${finding.line} - ${finding.title}`);
	}
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	if (options.help) {
		console.log("Usage: node scripts/quality/vibe-check.mjs [--root PATH] [--json PATH] [--fail-on high|critical|medium|low|none]");
		return;
	}

	const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
	const root = path.resolve(options.root ?? path.join(scriptDirectory, "..", ".."));
	const report = await scanRepository(root);
	printReport(report);

	if (options.json) {
		const output = path.resolve(root, options.json);
		await mkdir(path.dirname(output), { recursive: true });
		await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
	}

	if (options.failOn !== "none") {
		const threshold = severities.indexOf(options.failOn);
		if (report.results.some((finding) => severities.indexOf(finding.severity) >= threshold)) process.exitCode = 1;
	}
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
