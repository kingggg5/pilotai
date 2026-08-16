import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

import type { Settings } from "./config.js";

export function startTelemetry(settings: Settings) {
	if (!settings.OTEL_ENABLED) return undefined;
	const base = settings.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/$/u, "");
	const sdk = new NodeSDK({
		resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: settings.OTEL_SERVICE_NAME, [ATTR_SERVICE_VERSION]: settings.APP_VERSION }),
		traceExporter: new OTLPTraceExporter(base ? { url: `${base}/v1/traces` } : undefined),
		metricReader: new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter(base ? { url: `${base}/v1/metrics` } : undefined), exportIntervalMillis: 15_000 }),
		instrumentations: [getNodeAutoInstrumentations()],
	});
	sdk.start();
	return sdk;
}
