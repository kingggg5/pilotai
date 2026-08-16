import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	output: "standalone",
	poweredByHeader: false,
	reactStrictMode: true,
	cacheMaxMemorySize: 0,
	deploymentId: process.env.DEPLOYMENT_VERSION,
	allowedDevOrigins: ["localhost", "127.0.0.1"],
	// Type checking is a separate mandatory CI/Docker step, so Next does not repeat it in a worker.
	typescript: {
		ignoreBuildErrors: true,
	},
	experimental: {
		workerThreads: true,
	},
	turbopack: {
		root: process.cwd(),
	},
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{ key: "X-Content-Type-Options", value: "nosniff" },
					{ key: "X-Frame-Options", value: "DENY" },
					{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
					{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
					{ key: "Cross-Origin-Opener-Policy", value: "same-origin" },
					{ key: "X-Accel-Buffering", value: "no" },
				],
			},
		];
	},
};

export default nextConfig;
