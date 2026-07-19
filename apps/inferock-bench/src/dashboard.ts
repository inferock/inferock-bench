import { normalizeCanonicalEvent } from "@inferock/measure/canonical-event";
import type { Provider } from "@inferock/measure/pricing";
import { estimateCostUsd } from "@inferock/measure/stateless";
import {
  benchKeyFromConfig,
  maskSecret,
  providerBaseUrl,
  providerKeyStatus,
  type BenchConfig,
  type BenchPaths,
  type ProviderKeyStatus,
} from "./config.js";
import type { ProviderName } from "./provider.js";
import { createReceiptBundle, renderReceipt } from "./receipt.js";
import {
  selectStoredBenchEvents,
  type StoredBenchEvent,
  type StoredBenchEventScope,
} from "./storage.js";
import { summarizeBenchEvents, type BenchSummary } from "./summary.js";
import { PROVIDER_NAMES } from "./provider.js";
import { BENCH_PACKAGE_VERSION } from "./version.js";

export interface DashboardProviderState extends ProviderKeyStatus {
  readonly providerApiBaseUrl: string;
}

export interface DashboardSetupState {
  readonly maskedBenchKey: string | null;
  readonly canRevealBenchKey: boolean;
  readonly benchKeySource: "config" | "env" | "missing";
  readonly configPath: string | null;
  readonly providers: Record<ProviderName, DashboardProviderState>;
}

export interface DashboardKeyReveal {
  readonly benchKey: string;
  readonly maskedBenchKey: string | null;
}

export interface RecentCall {
  readonly time: string;
  readonly provider: Provider;
  readonly model: string;
  readonly statusCode: number;
  readonly status: "ok" | "error";
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number;
}

export type DashboardState = "no-provider" | "configured" | "calls-flowing";

export function dashboardSetupState(input: {
  readonly config: BenchConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly paths?: BenchPaths;
}): DashboardSetupState {
  const env = input.env ?? process.env;
  const benchKey = configuredBenchKey(input.config, env);
  return {
    maskedBenchKey: benchKey ? maskSecret(benchKey) : null,
    canRevealBenchKey: Boolean(benchKey),
    benchKeySource: env.INFEROCK_BENCH_KEY
      ? input.config.benchKey ? "config" : "env"
      : input.config.benchKey
        ? "config"
        : "missing",
    configPath: input.paths?.configFile ?? null,
    providers: Object.fromEntries(PROVIDER_NAMES.map((provider) => [
      provider,
      providerState(provider, input.config, env),
    ])) as Record<ProviderName, DashboardProviderState>,
  };
}

export function revealBenchKeyPayload(input: {
  readonly config: BenchConfig;
  readonly env?: NodeJS.ProcessEnv;
}): DashboardKeyReveal {
  const benchKey = configuredBenchKey(input.config, input.env ?? process.env);
  return {
    benchKey,
    maskedBenchKey: benchKey ? maskSecret(benchKey) : null,
  };
}

export function dashboardStateFor(
  setup: DashboardSetupState,
  summary: BenchSummary,
): DashboardState {
  const hasProvider = Object.values(setup.providers).some((provider) => provider.configured);
  if (!hasProvider) return "no-provider";
  return summary.measuredCalls > 0 ? "calls-flowing" : "configured";
}

export function recentCallsFromRecords(
  records: readonly StoredBenchEvent[],
  limit: number,
  scope: StoredBenchEventScope = {},
): RecentCall[] {
  return selectStoredBenchEvents(records, scope)
    .map((record) => normalizeCanonicalEvent(record.event))
    .sort((left, right) =>
      new Date(right.timing.startedAt).getTime() - new Date(left.timing.startedAt).getTime())
    .slice(0, limit)
    .map((event) => ({
      time: event.timing.startedAt,
      provider: event.request.provider,
      model: event.response.servedModel || event.request.requestedModel || event.request.model,
      statusCode: event.response.statusCode,
      status: event.response.statusCode < 400 ? "ok" : "error",
      inputTokens: event.usage.input,
      outputTokens: event.usage.output,
      totalTokens: totalTokens(event),
      costUsd: estimateCostUsd(event),
    }));
}

export function summaryPayload(input: {
  readonly records: readonly StoredBenchEvent[];
  readonly config: BenchConfig;
  readonly env?: NodeJS.ProcessEnv;
  readonly paths?: BenchPaths;
  readonly scope?: StoredBenchEventScope;
}) {
  const summary = summarizeBenchEvents(input.records, input.scope ?? {}, { config: input.config });
  const setup = dashboardSetupState(input);
  return {
    summary,
    setup,
    dashboardState: dashboardStateFor(setup, summary),
  };
}

export function receiptPayload(input: {
  readonly records: readonly StoredBenchEvent[];
  readonly config: BenchConfig;
  readonly scope?: StoredBenchEventScope;
}) {
  // Aggregate /api/receipt payloads are recomputed from stored events; there is no product loader for aggregate receipt-*.json files.
  const summary = summarizeBenchEvents(input.records, input.scope ?? {}, { config: input.config });
  const bundle = createReceiptBundle(summary);
  return {
    bundle,
    compactText: renderReceipt(bundle, true),
  };
}

export function renderDashboardHtml(input: { readonly managementAccessToken?: string } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inferock Bench</title>
  <style>
    :root {
      color-scheme: light;
      --canvas: #F7F5F2;
      --card: #FFFFFF;
      --hairline: #E8E4DE;
      --ink: #1F1D1A;
      --secondary: #6F6A62;
      --indigo: #4F46E5;
      --white: #FFFFFF;
      --selected-border: rgba(31,29,26,.22);
      --hover-border: rgba(31,29,26,.28);
      --placeholder: rgba(111,106,98,.72);
      --backdrop: rgba(31,29,26,.34);
      --shadow: 0 1px 3px rgba(31,29,26,.05);
      --shadow-hover: 0 6px 16px rgba(31,29,26,.10);
      --shadow-dialog: 0 24px 90px rgba(31,29,26,.22);
      --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter-fallback", sans-serif;
      --serif: "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      --radius: 14px;
      --radius-pill: 999px;
      --border-size: 1px;
      --space-0: 0;
      --space-half: 4px;
      --space-1: 8px;
      --space-1-5: 12px;
      --space-2: 16px;
      --space-3: 24px;
      --space-4: 32px;
      --space-5: 40px;
      --space-6: 48px;
      --space-section: 56px;
      --space-page-bottom: 72px;
      --type-xs: 13px;
      --type-sm: 15px;
      --type-body: 17px;
      --type-subhead: 22px;
      --type-section: 30px;
      --type-display: 46px;
      --type-metric: 26px;
      --leading-body: 1.45;
      --leading-lead: 1.55;
      --leading-tight: 1.05;
      --leading-section: 1.15;
      --leading-code: 1.5;
      --weight-regular: 400;
      --weight-medium: 500;
      --weight-semibold: 650;
      --tracking-none: 0;
      --page-max: 720px;
      --capture-page-max: 1052px;
      --dialog-width: 760px;
      --dialog-offset: 28px;
      --control-min: 44px;
      --input-min: 48px;
      --scope-min: 40px;
      --progress-height: 8px;
      --details-max: 62vh;
      --pre-max: 360px;
      --sr-size: 1px;
      --sr-offset: -1px;
      --motion: 180ms ease-out;
      --motion-reduced: 0.001ms;
      --motion-lift: -1px;
      --motion-offset: 8px;
      --disabled-opacity: .48;
      font-family: var(--sans);
    }
    * { box-sizing: border-box; }
    html {
      background: var(--canvas);
      color: var(--ink);
      font-family: var(--sans);
      font-size: var(--type-body);
      line-height: var(--leading-body);
    }
    body {
      min-height: 100vh;
      margin: var(--space-0);
      background: var(--canvas);
      color: var(--ink);
      letter-spacing: var(--tracking-none);
    }
    button, input, select, textarea { font: inherit; letter-spacing: var(--tracking-none); }
    button {
      min-height: var(--control-min);
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      background: transparent;
      color: var(--secondary);
      padding: var(--space-1) var(--space-2);
      cursor: pointer;
      transition: border-color var(--motion), box-shadow var(--motion), color var(--motion), background-color var(--motion), transform var(--motion);
    }
    button:hover:not(:disabled) {
      transform: translateY(var(--motion-lift));
      border-color: var(--hover-border);
      color: var(--ink);
    }
    button:disabled { cursor: default; opacity: var(--disabled-opacity); }
    button:focus-visible,
    input:focus-visible,
    select:focus-visible,
    summary:focus-visible {
      outline: var(--border-size) solid var(--indigo);
      outline-offset: var(--space-half);
    }
    button.primary {
      border-color: var(--ink);
      background: var(--ink);
      color: var(--white);
      font-weight: var(--weight-semibold);
      box-shadow: var(--shadow);
    }
    button.primary:hover:not(:disabled) { box-shadow: var(--shadow-hover); }
    button.secondary,
    summary.text-summary {
      border: var(--border-size) solid var(--hairline);
      background: var(--card);
      color: var(--ink);
      box-shadow: var(--shadow);
    }
    button.link,
    .text-button {
      min-height: var(--space-0);
      border: var(--space-0);
      border-radius: var(--space-0);
      background: transparent;
      color: var(--indigo);
      padding: var(--space-0);
      box-shadow: none;
      text-decoration: underline;
      text-underline-offset: var(--space-half);
    }
    button.link:hover,
    .text-button:hover {
      transform: none;
      color: var(--indigo);
    }
    button.danger {
      border-color: var(--hairline);
      background: var(--card);
      color: var(--ink);
      box-shadow: var(--shadow);
    }
    input, select {
      width: 100%;
      min-height: var(--input-min);
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      background: var(--card);
      color: var(--ink);
      padding: var(--space-1) var(--space-2);
      box-shadow: var(--shadow);
      outline: none;
      transition: border-color var(--motion), box-shadow var(--motion);
    }
    input::placeholder { color: var(--placeholder); }
    input:focus, select:focus { border-color: var(--indigo); }
    h1, h2, h3, p, dl { margin: var(--space-0); }
    h1, h2, h3 {
      color: var(--ink);
      letter-spacing: var(--tracking-none);
    }
    h1 {
      max-width: var(--page-max);
      font-size: var(--type-display);
      line-height: var(--leading-tight);
      font-weight: var(--weight-medium);
    }
    h2 {
      font-size: var(--type-section);
      line-height: var(--leading-section);
      font-weight: var(--weight-semibold);
    }
    h3 {
      font-size: var(--type-body);
      line-height: var(--leading-body);
      font-weight: var(--weight-semibold);
    }
    code, pre { font-family: var(--mono); letter-spacing: var(--tracking-none); }
    code {
      display: inline-block;
      max-width: 100%;
      overflow-wrap: anywhere;
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      background: var(--card);
      color: var(--ink);
      padding: var(--space-1) var(--space-1-5);
      font-size: var(--type-xs);
    }
    pre,
    .raw-block {
      overflow: auto;
      max-height: var(--pre-max);
      margin: var(--space-0);
      border-top: var(--border-size) solid var(--hairline);
      background: transparent;
      color: var(--ink);
      padding: var(--space-2) var(--space-0) var(--space-0);
      font-family: var(--mono);
      font-size: var(--type-xs);
      line-height: var(--leading-code);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .page {
      width: 100%;
      max-width: var(--page-max);
      margin: var(--space-0) auto;
      padding: var(--space-6) var(--space-3) var(--space-page-bottom);
    }
    .topbar {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
      padding-bottom: var(--space-3);
      border-bottom: var(--border-size) solid var(--hairline);
      margin-bottom: var(--space-section);
    }
    .brand { display: grid; gap: var(--space-1); }
    .brand-name {
      font-size: var(--type-body);
      font-weight: var(--weight-semibold);
      line-height: 1.2;
    }
    .status-line {
      color: var(--secondary);
      font-size: var(--type-xs);
      line-height: var(--leading-body);
    }
    .stage {
      display: none;
      animation: appear var(--motion);
    }
    body[data-static-capture="dashboard-real-traffic"] {
      --page-max: var(--capture-page-max);
    }
    body[data-static-capture="dashboard-real-traffic"] [data-testid="open-settings"],
    body[data-static-capture="dashboard-real-traffic"] .time-edit-grid {
      display: none !important;
    }
    body[data-stage="empty"] #emptyStage,
    body[data-stage="running"] #runningStage,
    body[data-stage="done"] #doneStage {
      display: grid;
    }
    @keyframes appear {
      from { opacity: var(--space-0); transform: translateY(var(--motion-offset)); }
      to { opacity: 1; transform: translateY(var(--space-0)); }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: var(--motion-reduced) !important;
        animation-iteration-count: 1 !important;
        scroll-behavior: auto !important;
        transition-duration: var(--motion-reduced) !important;
      }
    }
    .section { margin-top: var(--space-section); }
    .section:first-child { margin-top: var(--space-0); }
    .front-stage,
    .setup-stack,
    .running-shell,
    .receipt-stage,
    .stack {
      gap: var(--space-4);
    }
    .setup-stack,
    .stack {
      display: grid;
    }
    .hero-copy,
    .key-panel,
    .choice-panel,
    .price-card,
    .field-stack,
    .info-block {
      display: grid;
      gap: var(--space-2);
    }
    .display-title,
    .money-headline {
      font-family: var(--serif);
      font-size: var(--type-display);
      font-weight: var(--weight-medium);
      line-height: var(--leading-tight);
      letter-spacing: var(--tracking-none);
    }
    .lead,
    .subhead {
      max-width: 620px;
      color: var(--secondary);
      font-size: var(--type-body);
      line-height: var(--leading-lead);
    }
    .subhead-title {
      margin-bottom: var(--space-2);
      font-size: var(--type-subhead);
      font-weight: var(--weight-semibold);
      line-height: 1.2;
    }
    .small {
      color: var(--secondary);
      font-size: var(--type-sm);
      line-height: var(--leading-body);
    }
    .muted { color: var(--secondary); }
    .label {
      margin-bottom: var(--space-1);
      color: var(--secondary);
      font-size: var(--type-xs);
      line-height: 1.35;
    }
    .section-title {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-2);
      margin-bottom: var(--space-2);
    }
    .section-title h2 {
      font-size: var(--type-body);
      line-height: 1.3;
      font-weight: var(--weight-semibold);
    }
    .fields,
    .field-list {
      display: grid;
      gap: var(--space-2);
    }
    .model-choice {
      display: grid;
      gap: var(--space-2);
      padding-top: var(--space-2);
    }
    .model-choice[hidden] { display: none; }
    .key-panel.compact-key-panel { order: 10; }
    .model-picker-list {
      display: grid;
      gap: var(--space-2);
    }
    .model-row {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: var(--space-2);
      align-items: start;
    }
    .model-copy {
      display: grid;
      gap: var(--space-half);
      color: var(--ink);
      font-size: var(--type-sm);
      font-weight: var(--weight-semibold);
    }
    .model-hint {
      color: var(--secondary);
      font-size: var(--type-xs);
      font-weight: var(--weight-regular);
    }
    .field-row {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: var(--space-2);
      align-items: start;
    }
    .field-row > span,
    .field-label {
      color: var(--ink);
      font-size: var(--type-sm);
      font-weight: var(--weight-semibold);
    }
    .provider-meta {
      min-height: var(--space-3);
      display: flex;
      align-items: center;
      gap: var(--space-1);
      color: var(--secondary);
      font-size: var(--type-sm);
    }
    .segmented,
    .scope-grid,
    .button-row,
    .detail-links,
    .receipt-actions,
    .tab-list,
    .drawer-tabs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .scope-grid button,
    .detail-tab,
    .drawer-tabs button {
      min-height: var(--scope-min);
      border-color: var(--hairline);
      background: transparent;
      color: var(--secondary);
      font-size: var(--type-xs);
      line-height: 1.1;
    }
    .scope-grid button[aria-pressed="true"],
    .detail-tab[aria-selected="true"],
    .drawer-tabs button[aria-selected="true"] {
      border-color: var(--selected-border);
      background: var(--card);
      color: var(--ink);
      box-shadow: var(--shadow);
    }
    .price-card,
    .price-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding-top: var(--space-4);
      border-top: var(--border-size) solid var(--hairline);
    }
    .price-line p {
      margin: var(--space-0);
      font-size: var(--type-body);
      line-height: var(--leading-body);
    }
    .previous-results-line {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .previous-results-line[hidden] { display: none; }
    .run-history-list {
      display: grid;
      gap: var(--space-1);
      padding-top: var(--space-2);
    }
    .run-history-list[hidden] { display: none; }
    .run-history-actions {
      display: grid;
      gap: var(--space-1);
    }
    .run-history-button {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      width: 100%;
      justify-content: space-between;
      text-align: left;
      white-space: normal;
    }
    .run-history-button[aria-pressed="true"] {
      border-color: var(--selected-border);
      background: var(--card);
      color: var(--ink);
      box-shadow: var(--shadow);
    }
    #priceTag {
      color: var(--ink);
      font-weight: var(--weight-regular);
    }
    .primary-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin-top: var(--space-2);
    }
    .byok-note {
      border-left: var(--border-size) solid var(--hairline);
      padding-left: var(--space-2);
      color: var(--secondary);
    }
    .card,
    .surface,
    .receipt-card,
    .action-card,
    .details-shell,
    .info-block,
    dialog {
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      background: var(--card);
      box-shadow: var(--shadow);
    }
    .card,
    .surface,
    .receipt-card,
    .details-shell,
    .info-block {
      padding: var(--space-4);
    }
    .running-shell { margin: var(--space-0) auto; }
    .running-line {
      color: var(--secondary);
      font-size: var(--type-subhead);
      line-height: 1.2;
      margin-top: var(--space-2);
    }
    .progress-track {
      height: var(--progress-height);
      border-radius: var(--radius);
      background: var(--hairline);
      overflow: hidden;
      margin: var(--space-4) var(--space-0);
    }
    .progress-fill {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: var(--ink);
      transition: width var(--motion);
    }
    .run-metrics,
    .receipt-meta {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-1);
    }
    .metric,
    .meta-tile {
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      padding: var(--space-2);
      background: var(--card);
      min-height: var(--space-section);
    }
    .metric strong,
    .meta-tile strong,
    .ledger-row strong,
    .table-number,
    .amount,
    dd {
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1;
    }
    .metric strong,
    .meta-tile strong {
      display: block;
      color: var(--ink);
      font-size: var(--type-metric);
      line-height: var(--leading-tight);
      font-weight: var(--weight-semibold);
    }
    .metric span,
    .meta-tile span {
      display: block;
      color: var(--secondary);
      font-size: var(--type-xs);
      line-height: var(--leading-body);
      margin-top: var(--space-1);
    }
    .current-step,
    .run-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      margin-top: var(--space-4);
    }
    .live-details {
      display: none;
      gap: var(--space-2);
      border-top: var(--border-size) solid var(--hairline);
      padding-top: var(--space-3);
      margin-top: var(--space-3);
    }
    .live-details.visible { display: grid; }
    .task-list,
    .call-list,
    .surface-list,
    .connection-grid,
    .fingerprint-grid {
      display: grid;
      gap: var(--space-1);
    }
    .task-row,
    .modal-row,
    .ledger-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(7rem, 1fr);
      gap: var(--space-3);
      align-items: baseline;
      padding: var(--space-2) var(--space-0);
      border-bottom: var(--border-size) solid var(--hairline);
    }
    .receipt-stage { gap: var(--space-4); }
    .receipt-hero {
      display: grid;
      grid-template-columns: minmax(0, .85fr) minmax(0, 1.42fr) minmax(0, .85fr) minmax(0, 1.18fr);
      gap: var(--space-1);
      align-items: stretch;
    }
    .headline-card {
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      gap: var(--space-1);
    }
    .headline-card-label {
      display: flex;
      align-items: flex-start;
      margin-bottom: var(--space-0);
      color: var(--ink);
      font-size: var(--type-sm);
      font-weight: var(--weight-semibold);
      line-height: var(--leading-body);
      overflow-wrap: normal;
      white-space: nowrap;
    }
    .headline-card-gloss {
      overflow-wrap: normal;
      white-space: nowrap;
    }
    .headline-card-value {
      max-width: 100%;
      overflow-wrap: normal;
      white-space: nowrap;
      word-break: normal;
      font-size: var(--type-section);
    }
    .summary-secondary-line {
      display: block;
      color: var(--secondary);
      font-size: var(--type-xs);
      line-height: var(--leading-body);
      margin-top: var(--space-1);
      overflow-wrap: anywhere;
    }
    .receipt-title-line {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin-bottom: var(--space-2);
    }
    .receipt-title-line .subhead-title {
      margin-bottom: var(--space-0);
    }
    .receipt-title-note {
      display: inline;
      margin-top: var(--space-0);
    }
    .receipt-card {
      border-color: transparent;
      background: transparent;
      box-shadow: none;
      margin-top: var(--space-0);
      padding: var(--space-0);
    }
    .receipt-ledger,
    .ledger {
      display: grid;
      margin-bottom: var(--space-0);
      border-top: var(--border-size) solid var(--hairline);
    }
    .receipt-ledger {
      grid-template-columns: minmax(0, 1fr) minmax(7rem, max-content);
      column-gap: var(--space-3);
      align-items: stretch;
    }
    @media (min-width: 760px) {
      .receipt-ledger {
        grid-template-columns:
          minmax(12rem, 1fr) minmax(7rem, max-content)
          minmax(12rem, 1fr) minmax(7rem, max-content);
        column-gap: var(--space-3);
      }
    }
    @media (max-width: 760px) {
      .receipt-hero {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .ledger-row:last-child { border-bottom: var(--border-size) solid var(--hairline); }
    .receipt-ledger > dt,
    .receipt-ledger > dd {
      min-width: 0;
      display: flex;
      align-items: baseline;
      padding: var(--space-2) var(--space-0);
      border-bottom: var(--border-size) solid var(--hairline);
    }
    .ledger-row span:first-child,
    .receipt-ledger > dt {
      color: var(--secondary);
      font-size: var(--type-sm);
    }
    .ledger-row strong,
    .receipt-ledger > dd {
      color: var(--ink);
      font-size: var(--type-body);
      font-weight: var(--weight-semibold);
      justify-content: flex-end;
      margin: var(--space-0);
      text-align: right;
    }
    .receipt-ledger > dd {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    .receipt-meta {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      margin-top: var(--space-4);
    }
    .action-section {
      display: grid;
      gap: var(--space-2);
      margin-top: var(--space-0);
    }
    .action-cards,
    .action-grid {
      display: grid;
      gap: var(--space-2);
    }
    .action-card {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3);
    }
    .exposure-action-card {
      gap: var(--space-1);
      padding-block: var(--space-2);
    }
    .card-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-3);
      align-items: baseline;
    }
    .card-head h3 { margin-bottom: var(--space-0); }
    .action-card .money,
    .gap-amount {
      color: var(--ink);
      white-space: nowrap;
      font-size: var(--type-body);
      font-weight: var(--weight-semibold);
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1;
    }
    .time-edit-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .time-edit-field {
      display: grid;
      gap: var(--space-1);
      min-width: 0;
    }
    .time-edit-field span {
      color: var(--muted);
      font-size: var(--type-caption);
      font-weight: var(--weight-medium);
    }
    .time-edit-field input {
      min-width: 0;
      width: 100%;
    }
    .receipt-actions {
      justify-content: flex-end;
      margin-top: var(--space-4);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      width: fit-content;
      min-height: var(--space-3);
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      padding: var(--space-half) var(--space-1);
      color: var(--secondary);
      background: var(--card);
      font-size: var(--type-xs);
      font-weight: var(--weight-semibold);
      white-space: nowrap;
    }
    .badge.good,
    .badge.info,
    .badge.attn {
      color: var(--ink);
      background: var(--card);
      border-color: var(--selected-border);
    }
    .details-intro {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .tab-list {
      margin-bottom: var(--space-3);
      padding-bottom: var(--space-2);
      border-bottom: var(--border-size) solid var(--hairline);
    }
    .details-shell,
    .tab-panel,
    .table-wrap {
      min-width: 0;
    }
    .tab-panel { animation: appear var(--motion); }
    .tab-panel[hidden] { display: none; }
    .table-wrap {
      overflow-x: auto;
      width: 100%;
      max-width: 100%;
      border-top: var(--border-size) solid var(--hairline);
    }
    table {
      width: 100%;
      min-width: 720px;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th,
    td {
      padding: 14px 12px;
      border-bottom: var(--border-size) solid var(--hairline);
      text-align: left;
      vertical-align: top;
      color: var(--ink);
      font-size: var(--type-xs);
      line-height: 1.4;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    th {
      color: var(--secondary);
      font-weight: var(--weight-semibold);
      white-space: normal;
    }
    td.table-number,
    th.table-number { text-align: right; font-family: var(--sans); }
    .status { color: var(--secondary); white-space: nowrap; }
    .code-label {
      margin-bottom: var(--space-1);
      color: var(--secondary);
      font-size: var(--type-xs);
      line-height: 1.35;
    }
    dialog {
      color: var(--ink);
      padding: var(--space-0);
      max-width: min(var(--dialog-width), calc(100vw - var(--dialog-offset)));
      width: var(--dialog-width);
      box-shadow: var(--shadow-dialog);
    }
    dialog::backdrop { background: var(--backdrop); }
    .modal-shell {
      display: grid;
      gap: var(--space-3);
      padding: var(--space-4);
      background: var(--card);
      border-radius: inherit;
    }
    .modal-head {
      display: flex;
      align-items: start;
      justify-content: space-between;
      gap: var(--space-3);
    }
    .modal-row:last-child { border-bottom: var(--border-size) solid var(--hairline); }
    .estimate-lines {
      display: grid;
      gap: var(--space-1);
      border-top: var(--border-size) solid var(--hairline);
      padding-top: var(--space-2);
    }
    .estimate-line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-2);
      align-items: baseline;
      color: var(--secondary);
      font-size: var(--type-sm);
    }
    .estimate-line strong {
      color: var(--ink);
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1;
    }
    .reveal-panel {
      display: none;
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      background: var(--card);
      padding: var(--space-2);
      gap: var(--space-1);
    }
    .reveal-panel.visible { display: grid; }
    .drawer-body {
      display: grid;
      gap: var(--space-2);
      max-height: var(--details-max);
      overflow: auto;
      padding-right: var(--space-half);
    }
    .call-item,
    .surface-item {
      border: var(--border-size) solid var(--hairline);
      border-radius: var(--radius);
      padding: var(--space-1);
      background: var(--card);
      display: grid;
      gap: var(--space-half);
      font-size: var(--type-sm);
    }
    .local-key-line {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: var(--space-1);
      align-items: center;
    }
    .advanced-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: var(--space-2);
    }
    .inline-checkbox {
      width: auto;
      min-height: auto;
      margin-right: var(--space-1);
      box-shadow: none;
    }
    .sr-only {
      position: absolute;
      width: var(--sr-size);
      height: var(--sr-size);
      padding: var(--space-0);
      margin: var(--sr-offset);
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: var(--space-0);
    }
    @media (max-width: 640px) {
      .page { padding: var(--space-4) var(--space-2) var(--space-section); }
      .topbar {
        gap: var(--space-2);
        margin-bottom: var(--space-5);
      }
      .price-line { order: 1; }
      .key-panel { order: 2; }
      .choice-panel { order: 3; }
      .setup-stack > div:last-child { order: 4; }
      .price-line,
      .current-step,
      .run-actions,
      .details-intro {
        flex-direction: column;
        align-items: stretch;
      }
      .field-row,
      .task-row,
      .modal-row,
      .ledger-row,
      .receipt-hero,
      .card-head,
      .local-key-line,
      .model-row,
      .estimate-line {
        grid-template-columns: 1fr;
        gap: var(--space-1);
      }
      .run-metrics,
      .receipt-meta,
      .advanced-grid {
        grid-template-columns: 1fr;
      }
      .receipt-ledger > dd,
      .ledger-row strong,
      td.table-number,
      th.table-number { text-align: left; }
      .receipt-ledger > dd { justify-content: flex-start; }
      .card,
      .surface,
      .receipt-card,
      .details-shell,
      .info-block {
        padding: var(--space-3);
      }
    }
  </style>
</head>
<body data-stage="empty">
  <main class="page">
    <header class="topbar">
      <div class="brand">
        <div class="brand-name">Inferock Bench</div>
        <p class="status-line" id="refreshStatus" data-testid="refresh-status">Loading local dashboard...</p>
      </div>
      <button id="openSettingsButton" type="button" data-testid="open-settings">Settings</button>
    </header>

    <section class="stage front-stage" id="emptyStage" aria-labelledby="emptyHeadline" data-testid="empty-run-state">
      <section class="section setup-stack run-panel" aria-labelledby="emptyHeadline">
        <div class="hero-copy">
          <h1 class="display-title" id="emptyHeadline">Find the loss your provider did not recognize</h1>
          <p class="lead">Connect a provider key from this machine. The bench prices the run first, then asks before any provider call is made.</p>
        </div>

        <div class="key-panel" id="keyPanel" aria-labelledby="providerKeysTitle">
          <div>
            <p class="label" id="providerKeysTitle">Provider keys</p>
            <span class="small muted" id="setupPath" data-testid="setup-path"></span>
          </div>
          <div class="fields" aria-label="Provider keys">
            <label class="field-row">
              <span>OpenAI</span>
              <span class="field-stack">
                <input id="openaiKeyInput" data-testid="provider-key-openai" type="password" autocomplete="off" spellcheck="false" placeholder="Paste OpenAI key" aria-label="Paste OpenAI key">
                <span class="provider-meta" id="openaiMeta" data-testid="provider-openai-mask">Not added yet</span>
              </span>
            </label>
            <label class="field-row">
              <span>Anthropic</span>
              <span class="field-stack">
                <input id="anthropicKeyInput" data-testid="provider-key-anthropic" type="password" autocomplete="off" spellcheck="false" placeholder="Paste Anthropic key" aria-label="Paste Anthropic key">
                <span class="provider-meta" id="anthropicMeta" data-testid="provider-anthropic-mask">Not added yet</span>
              </span>
            </label>
            <label class="field-row">
              <span>Gemini</span>
              <span class="field-stack">
                <input id="geminiKeyInput" data-testid="provider-key-gemini" type="password" autocomplete="off" spellcheck="false" placeholder="Paste Gemini key" aria-label="Paste Gemini key">
                <span class="provider-meta" id="geminiMeta" data-testid="provider-gemini-mask">Not added yet</span>
              </span>
            </label>
            <label class="field-row">
              <span>OpenRouter</span>
              <span class="field-stack">
                <input id="openrouterKeyInput" data-testid="provider-key-openrouter" type="password" autocomplete="off" spellcheck="false" placeholder="Paste OpenRouter key" aria-label="Paste OpenRouter key">
                <span class="provider-meta" id="openrouterMeta" data-testid="provider-openrouter-mask">Not added yet</span>
              </span>
            </label>
          </div>
          <p class="byok-note small">Provider keys are not sent to Inferock; attached only to provider requests. This spends from your provider account only after you accept the price.</p>
        </div>

        <div class="choice-panel" aria-labelledby="providerScopeTitle">
          <p class="label" id="providerScopeTitle">Test providers</p>
          <div class="scope-grid segmented" role="group" aria-label="Test providers">
            <button type="button" data-provider-scope="all" data-testid="provider-scope-all" aria-pressed="true">All configured</button>
            <button type="button" data-provider-scope="openai" data-testid="provider-scope-openai" aria-pressed="false">OpenAI only</button>
            <button type="button" data-provider-scope="anthropic" data-testid="provider-scope-anthropic" aria-pressed="false">Anthropic only</button>
            <button type="button" data-provider-scope="gemini" data-testid="provider-scope-gemini" aria-pressed="false">Gemini only</button>
            <button type="button" data-provider-scope="openrouter" data-testid="provider-scope-openrouter" aria-pressed="false">OpenRouter only</button>
          </div>
          <div class="model-choice" id="modelChoicePanel" aria-labelledby="modelChoiceTitle" data-testid="model-choice-panel" hidden>
            <p class="label" id="modelChoiceTitle">Models</p>
            <div class="model-picker-list" id="modelPickerList" data-testid="model-picker-list"></div>
          </div>
        </div>

        <div class="price-line" aria-label="Run price">
          <div>
            <p id="priceTag" data-testid="price-tag">Waiting for a provider key</p>
            <p class="small muted" id="priceSubtext" data-testid="price-subtext">No provider calls happen before the price sheet.</p>
          </div>
          <button class="primary" id="runTestButton" type="button" data-testid="run-test-button" disabled>Run test</button>
        </div>

        <div class="previous-results-line" id="previousResultsLine" data-testid="previous-results-line" hidden>
          <button class="link" id="viewPreviousResultsButton" type="button" data-testid="view-previous-results">View previous results</button>
          <span class="small muted">Saved on this computer.</span>
        </div>

        <div>
          <p class="label">Details</p>
          <div class="detail-links button-row" aria-label="Details">
            <button class="link" type="button" id="privacyDetailsButton" data-testid="what-leaves-machine">What leaves my machine</button>
            <button class="link" type="button" id="advancedDetailsButton" data-testid="advanced-options-button">Advanced options</button>
            <button class="link" type="button" id="connectionDetailsButton" data-testid="local-app-connection-button">Local app connection</button>
          </div>
        </div>
      </section>
    </section>

    <section class="stage running-shell" id="runningStage" aria-labelledby="runningHeadline" data-testid="running-state">
      <section class="surface">
        <h2 id="runningHeadline">Running the test</h2>
        <p class="running-line" id="runningSpendLine" data-testid="running-spend-line">Spent $0.00 so far of about $0.00 estimated.</p>
        <div class="progress-track" id="progressTrack" role="progressbar" aria-label="Run progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="progress-fill" id="progressFill" data-testid="progress-fill"></div>
        </div>
        <div class="run-metrics">
          <div class="metric"><strong id="runningSurfaces" data-testid="running-surfaces">0 / 0</strong><span>Surfaces opening</span></div>
          <div class="metric"><strong id="runningCalls" data-testid="running-calls">0</strong><span>Provider calls started</span></div>
          <div class="metric"><strong id="runningCap" data-testid="running-cap-remaining">$0.00</strong><span>Spend cap remaining</span></div>
        </div>
        <div class="current-step">
          <span id="currentStep" data-testid="current-step">Current step: checking structured outputs</span>
          <button id="toggleLiveDetailsButton" type="button" data-testid="show-live-details">Show live details</button>
        </div>
        <div class="live-details" id="liveDetails" data-testid="live-details">
          <div class="info-block">
            <h3>Task progress</h3>
            <div class="task-list" id="taskList" data-testid="task-list"></div>
          </div>
          <div class="info-block">
            <h3>Run fingerprint</h3>
            <code id="runningFingerprint" data-testid="running-fingerprint">waiting</code>
          </div>
        </div>
        <div class="primary-row">
          <p class="small muted" id="abortCaveat" data-testid="abort-caveat">Already-started provider calls may still be billed if you abort.</p>
          <button class="danger" id="abortRunButton" type="button" data-testid="abort-run-button">Abort</button>
        </div>
      </section>
    </section>

    <section class="stage receipt-stage" id="doneStage" aria-labelledby="receiptLedgerTitle" data-testid="done-state">
      <section class="section" aria-label="Receipt totals">
        <p class="label" id="receiptModeLabel" data-testid="receipt-mode-label">Receipt</p>
        <p class="small muted" data-testid="bench-package-version">inferock-bench ${BENCH_PACKAGE_VERSION}</p>
        <p class="small muted" id="receiptModeNote" data-testid="receipt-mode-note" hidden></p>
        <div class="run-history-list" id="previousRunList" data-testid="previous-run-list" hidden></div>
        <div class="receipt-hero">
          <article class="headline-card">
            <div class="headline-card-label label">Spent</div>
            <div class="headline-card-gloss small muted">what providers charged</div>
            <strong class="headline-card-value money-headline" id="receiptSpentHeadline" data-testid="spent-headline">$0.00</strong>
          </article>
          <article class="headline-card">
            <div class="headline-card-label label">Money loss</div>
            <div class="headline-card-gloss small muted">lost within that bill</div>
            <strong class="headline-card-value money-headline" id="receiptMoneyLossHeadline" data-testid="money-headline-standard">$0.00</strong>
          </article>
          <article class="headline-card">
            <div class="headline-card-label label">Time lost</div>
            <div class="headline-card-gloss small muted">latency & downtime</div>
            <strong class="headline-card-value money-headline" id="receiptTimeLossHeadline" data-testid="time-headline">~0s</strong>
          </article>
          <article class="headline-card">
            <div class="headline-card-label label">Invoice-check exposure</div>
            <div class="headline-card-gloss small muted">double-check on your bill</div>
            <strong class="headline-card-value money-headline" id="receiptInvoiceCheckExposureHeadline" data-testid="invoice-check-exposure-headline">$0.00</strong>
          </article>
        </div>
      </section>

      <section class="section receipt-card" aria-labelledby="receiptLedgerTitle">
        <div class="receipt-title-line">
          <h2 class="subhead-title" id="receiptLedgerTitle">Receipt</h2>
          <span class="summary-secondary-line receipt-title-note" id="receiptMoneyLossSpendShare" data-testid="money-loss-spend-share">money loss = no priced spend measured</span>
        </div>
        <dl class="receipt-ledger ledger">
          <dt>Money loss</dt><dd id="receiptStandardLoss" data-testid="receipt-standard-loss">$0.00</dd>
          <dt>Already recognized by provider</dt><dd id="receiptRecognized" data-testid="receipt-provider-recognized">$0.00</dd>
          <dt>Money not recognized yet</dt><dd id="receiptGap" data-testid="receipt-gap">$0.00</dd>
          <dt>Duration loss</dt><dd id="receiptDurationLoss" data-testid="receipt-time-loss">~0s</dd>
          <dt>Invoice-check exposure</dt><dd id="receiptInvoiceCheckExposure" data-testid="receipt-invoice-check-exposure">$0.00</dd>
          <dt>Surfaces watched</dt><dd id="receiptSurfaces" data-testid="receipt-surfaces">0 / 0</dd>
          <dt>Provider recognized time</dt><dd id="receiptRecognizedTime" data-testid="receipt-provider-recognized-time">~0s</dd>
          <dt>Time not recognized yet</dt><dd id="receiptTimeGap" data-testid="receipt-time-gap">~0s</dd>
          <dt>Approx at your rate</dt><dd id="receiptDurationTranslation" data-testid="receipt-duration-translation">≈ $0.00</dd>
          <dt>Provider spend observed</dt><dd id="receiptProviderSpend" data-testid="receipt-provider-spend">$0.00</dd>
          <dt>Calls measured</dt><dd id="receiptCalls" data-testid="receipt-calls">0</dd>
          <dt>Failures</dt><dd id="receiptFailures" data-testid="receipt-failures">0</dd>
        </dl>
      </section>

      <section class="section action-section" aria-labelledby="actionsTitle">
        <h2 class="subhead-title" id="actionsTitle">What should I do about it?</h2>
        <div class="action-cards action-grid" id="actionCards" data-testid="action-cards"></div>
        <div class="receipt-actions">
          <button class="secondary" type="button" id="copyReceiptButton" data-testid="copy-receipt">Copy receipt</button>
          <button class="secondary" type="button" id="downloadReceiptButton" data-testid="download-receipt">Download receipt</button>
          <button class="primary" type="button" id="runAgainButton" data-testid="run-again">Run test</button>
        </div>
      </section>

      <section class="section details-shell" id="receiptDetails" aria-labelledby="receiptDetailsTitle" data-testid="receipt-details">
        <div class="details-intro">
          <div>
            <h2 class="subhead-title" id="receiptDetailsTitle">Details</h2>
            <p class="small">Signals, coverage, calls, raw receipt, connection, and run fingerprint stay here.</p>
          </div>
        </div>
        <div class="tab-list" role="tablist" aria-label="Receipt details">
          <button class="detail-tab" id="detailTabSignals" type="button" role="tab" aria-controls="detailPanelSignals" aria-selected="true" data-detail-tab="signals" data-testid="details-tab-signals">Signals</button>
          <button class="detail-tab" id="detailTabCoverage" type="button" role="tab" aria-controls="detailPanelCoverage" aria-selected="false" data-detail-tab="coverage" data-testid="details-tab-coverage">Coverage</button>
          <button class="detail-tab" id="detailTabCalls" type="button" role="tab" aria-controls="detailPanelCalls" aria-selected="false" data-detail-tab="calls" data-testid="details-tab-calls">Calls</button>
          <button class="detail-tab" id="detailTabRaw" type="button" role="tab" aria-controls="detailPanelRaw" aria-selected="false" data-detail-tab="raw" data-testid="details-tab-raw">Raw receipt</button>
          <button class="detail-tab" id="detailTabConnection" type="button" role="tab" aria-controls="detailPanelConnection" aria-selected="false" data-detail-tab="connection" data-testid="details-tab-connection">Connection</button>
          <button class="detail-tab" id="detailTabFingerprint" type="button" role="tab" aria-controls="detailPanelFingerprint" aria-selected="false" data-detail-tab="fingerprint" data-testid="details-tab-fingerprint">Run fingerprint</button>
        </div>
        <section class="tab-panel" id="detailPanelSignals" role="tabpanel" aria-labelledby="detailTabSignals" data-detail-panel="signals" data-testid="details-panel-signals"></section>
        <section class="tab-panel" id="detailPanelCoverage" role="tabpanel" aria-labelledby="detailTabCoverage" data-detail-panel="coverage" data-testid="details-panel-coverage" hidden></section>
        <section class="tab-panel" id="detailPanelCalls" role="tabpanel" aria-labelledby="detailTabCalls" data-detail-panel="calls" data-testid="details-panel-calls" hidden></section>
        <section class="tab-panel" id="detailPanelRaw" role="tabpanel" aria-labelledby="detailTabRaw" data-detail-panel="raw" data-testid="details-panel-raw" hidden></section>
        <section class="tab-panel" id="detailPanelConnection" role="tabpanel" aria-labelledby="detailTabConnection" data-detail-panel="connection" data-testid="details-panel-connection" hidden></section>
        <section class="tab-panel" id="detailPanelFingerprint" role="tabpanel" aria-labelledby="detailTabFingerprint" data-detail-panel="fingerprint" data-testid="details-panel-fingerprint" hidden></section>
      </section>
    </section>
  </main>

  <dialog id="consentDialog" data-testid="consent-dialog">
    <div class="modal-shell">
      <div class="modal-head">
        <div>
          <h2 id="consentTitle" data-testid="consent-title">Ready to spend ~$0.00 to measure everything?</h2>
          <p class="small muted">Provider keys are not sent to Inferock; attached only to provider requests. This spends from your provider account.</p>
        </div>
      </div>
      <div>
        <div class="modal-row"><span>Estimated provider spend</span><strong id="consentEstimatedUsd" data-testid="consent-estimate-usd">$0.00</strong></div>
        <div class="modal-row"><span>Maximum spend</span><strong id="consentSpendCapDisplay" data-testid="consent-spend-cap-display">$0.00</strong></div>
        <div class="modal-row"><span>Models</span><strong id="consentProviders" data-testid="consent-providers">None</strong></div>
      </div>
      <div class="estimate-lines" id="consentEstimateLines" data-testid="consent-estimate-lines"></div>
      <p class="small muted" id="consentFullBatteryNote" data-testid="consent-full-battery-note">The full battery always runs. Model choice only changes the price tier.</p>
      <div class="detail-links">
        <button class="link" id="showPricingDetailsButton" type="button" data-testid="show-pricing-details">Show pricing details</button>
        <button class="link" id="showFingerprintButton" type="button" data-testid="show-run-fingerprint">Show run fingerprint</button>
      </div>
      <div class="reveal-panel" id="pricingDetailsPanel" data-testid="pricing-details-panel"></div>
      <div class="reveal-panel" id="fingerprintPanel" data-testid="fingerprint-panel">
        <span class="small muted">Run fingerprint</span>
        <code id="consentFingerprint" data-testid="consent-fingerprint">waiting</code>
      </div>
      <div class="reveal-panel" id="agentInstallConsent" data-testid="agent-install-consent">
        <h3>Agent test install consent</h3>
        <p class="small muted">Review this local package before any install request is made.</p>
        <div id="agentInstallDetails" data-testid="agent-install-details"></div>
        <label class="field-label">
          <span><input class="inline-checkbox" id="agentInstallAck" data-testid="agent-install-ack" type="checkbox">I consent to this local agent download and install.</span>
        </label>
      </div>
      <p class="small muted" data-testid="consent-abort-caveat">Abort before starting makes zero provider calls. Already-started provider calls may still be billed.</p>
      <div class="primary-row">
        <button id="consentCancelButton" type="button" data-testid="consent-cancel">Cancel</button>
        <button class="primary" id="consentStartButton" type="button" data-testid="consent-start">Run test</button>
      </div>
    </div>
  </dialog>

  <dialog id="detailsDialog" data-testid="details-dialog">
    <div class="modal-shell">
      <div class="modal-head">
        <div>
          <h2 id="detailsTitle" data-testid="details-title">Details</h2>
          <p class="small muted" id="detailsSubtitle">Proof and raw receipt data stay here.</p>
        </div>
        <button type="button" id="closeDetailsButton" data-testid="close-details">Close</button>
      </div>
      <div class="drawer-tabs" id="detailsTabs"></div>
      <div class="drawer-body" id="detailsBody" data-testid="details-body"></div>
    </div>
  </dialog>

  <dialog id="settingsDialog" data-testid="settings-dialog">
    <div class="modal-shell">
      <div class="modal-head">
        <div>
          <h2>Settings</h2>
          <p class="small muted">Maintenance and proof controls. The main page keeps the run simple.</p>
        </div>
        <button type="button" id="closeSettingsButton" data-testid="close-settings">Close</button>
      </div>
      <div class="drawer-body">
        <section class="info-block">
          <h3>Provider keys</h3>
          <p class="small muted">Paste a key on the front page. Remove a saved key here.</p>
          <div class="primary-row">
            <button class="danger" type="button" data-remove-provider="openai" data-testid="remove-openai">Remove OpenAI</button>
            <button class="danger" type="button" data-remove-provider="anthropic" data-testid="remove-anthropic">Remove Anthropic</button>
            <button class="danger" type="button" data-remove-provider="gemini" data-testid="remove-gemini">Remove Gemini</button>
            <button class="danger" type="button" data-remove-provider="openrouter" data-testid="remove-openrouter">Remove OpenRouter</button>
          </div>
        </section>
        <section class="info-block" data-key-card>
          <h3>Local app connection</h3>
          <p class="small muted">Use this local key when your app sends requests to this bench.</p>
          <div class="local-key-line">
            <code id="benchKeyValue" data-testid="local-bench-key">local bench key configured</code>
            <button id="copyKeyButton" type="button" data-testid="reveal-copy-key">Reveal/copy</button>
          </div>
          <div id="snippetList" data-testid="sdk-snippets"></div>
        </section>
        <section class="info-block">
          <h3>Advanced options</h3>
          <div class="advanced-grid">
            <label class="field-label">Test driver
              <select id="coverageGeneratorSelect" data-testid="advanced-generator">
                <option value="built-in">Built-in test</option>
                <option value="agent">Agent test</option>
              </select>
            </label>
            <label class="field-label">Maximum spend
              <input id="coverageSpendCapInput" data-testid="advanced-spend-cap" type="number" min="0" step="0.000001" placeholder="Automatic">
            </label>
          </div>
        </section>
      </div>
    </div>
  </dialog>

  <script>
    const PROVIDER_NAMES = ${JSON.stringify(PROVIDER_NAMES)};
    const MANAGEMENT_ACCESS_TOKEN = ${JSON.stringify(input.managementAccessToken ?? "")};
    const state = {
      setup: null,
      summary: null,
      rows: [],
      calls: [],
      receipt: null,
      recomputedReceipt: null,
      coverageOptions: null,
      coverageEstimate: null,
      coverageRun: null,
      coverageReceipt: null,
      coverageEvents: null,
      coverageEventsRunId: null,
      coverageEstimateTimer: null,
      saveTimer: null,
      providerScope: "all",
      agentInstallAcknowledgedHash: null,
      viewingPreviousResults: false,
      receiptMode: "none",
      selectedReceiptRunId: null,
      recentRuns: [],
      selectedModelsByProvider: {},
      coverageEstimateRequestKey: null,
    };
    const $ = (id) => document.getElementById(id);

    function managementFetch(resource, options) {
      const headers = new Headers(options && options.headers ? options.headers : undefined);
      if (MANAGEMENT_ACCESS_TOKEN) headers.set("x-inferock-bench-management", MANAGEMENT_ACCESS_TOKEN);
      return fetch(resource, { ...(options || {}), headers });
    }
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const estimateMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 });
    const integer = new Intl.NumberFormat("en-US");

    function formatUsd(value) {
      return money.format(Number(value || 0));
    }

    function formatApproxTimeLost(ms) {
      const value = Number.isFinite(Number(ms)) && Number(ms) > 0 ? Number(ms) : 0;
      if (value < 60000) return "~" + integer.format(Math.round(value / 1000)) + "s";
      if (value < 3600000) return "~" + (value / 60000).toFixed(1) + " min";
      return "~" + (value / 3600000).toFixed(1) + " hr";
    }

    function formatEstimateUsd(value) {
      return estimateMoney.format(Number(value || 0));
    }

    function formatExposureUsd(value) {
      const numeric = Number(value || 0);
      if (numeric > 0 && numeric < 0.01) return "$" + numeric.toFixed(6);
      return formatUsd(numeric);
    }

    function invoiceCheckExposureAmount(exposures) {
      return (exposures || [])
        .map((exposure) => Number(exposure && exposure.amount || 0))
        .filter((amount) => Number.isFinite(amount) && amount > 0)
        .reduce((total, amount) => total + amount, 0);
    }

    function moneyLossObservedSpendLine(standardLossUsd, providerSpendUsd) {
      const standardLoss = Number(standardLossUsd);
      const providerSpend = Number(providerSpendUsd);
      if (!Number.isFinite(standardLoss) || standardLoss < 0 || !Number.isFinite(providerSpend) || providerSpend < 0) return null;
      if (providerSpend <= 0) return "money loss = no priced spend measured";
      const percent = standardLoss / providerSpend * 100;
      if (!Number.isFinite(percent) || percent > 100) return null;
      const formatted = percent.toFixed(1);
      if (formatted === "0.0" && standardLoss > 0) return null;
      const annotation = providerSpend < 1
        ? " (small sample: " + formatExposureUsd(providerSpend) + " measured)"
        : "";
      return "money loss = " + formatted + "% of observed spend" + annotation;
    }

    function moneyLossObservedSpendPercentFromLine(line) {
      const match = String(line || "").match(/^money loss = ([0-9]+(?:\\.[0-9])?)% of observed spend(?:\\s|$)/);
      return match && match[1] ? match[1] + "%" : null;
    }

    function moneyLossHeadlineValue(standardLossUsd, pricingUnknownCount, observedSpendLine) {
      const standardLoss = Number(standardLossUsd || 0);
      const hasPricingUnknown = Number(pricingUnknownCount || 0) > 0;
      if (hasPricingUnknown && standardLoss === 0) return "pricing unknown";
      const formatted = formatUsd(standardLoss);
      const percent = moneyLossObservedSpendPercentFromLine(observedSpendLine);
      return percent ? formatted + " (" + percent + ")" : formatted;
    }

    function providerLabel(provider) {
      if (provider === "openai") return "OpenAI";
      if (provider === "anthropic") return "Anthropic";
      if (provider === "gemini") return "Gemini";
      if (provider === "openrouter") return "OpenRouter";
      return String(provider || "Provider");
    }

    function providerListLabel(providers) {
      return providers.map(providerLabel).join(", ");
    }

    function sdkBaseUrl(provider) {
      if (provider === "openai") return location.origin + "/v1";
      if (provider === "openrouter") return location.origin + "/openrouter/v1";
      if (provider === "gemini") return location.origin + "/v1beta";
      return location.origin;
    }

    function snippetFor(provider) {
      if (provider === "gemini") {
        return "await fetch(\\"" + sdkBaseUrl(provider) + "/models/gemini-2.5-flash:generateContent\\", {\\n" +
          "  method: \\"POST\\",\\n" +
          "  headers: { authorization: \\"Bearer \\" + process.env.INFEROCK_BENCH_KEY, \\"content-type\\": \\"application/json\\" },\\n" +
          "  body: JSON.stringify({ contents: [{ role: \\"user\\", parts: [{ text: \\"Hello\\" }] }] }),\\n" +
          "});";
      }
      if (provider !== "openai" && provider !== "anthropic" && provider !== "openrouter") {
        throw new Error("Unsupported provider snippet: " + provider);
      }
      const client = provider === "anthropic" ? "anthropic" : provider;
      const ctor = provider === "anthropic" ? "Anthropic" : "OpenAI";
      return "const " + client + " = new " + ctor + "({\\n" +
        "  apiKey: process.env.INFEROCK_BENCH_KEY,\\n" +
        "  baseURL: \\"" + sdkBaseUrl(provider) + "\\",\\n" +
        "});";
    }

    function isCoverageRunActive() {
      const status = state.coverageRun && state.coverageRun.status;
      return status === "queued" || status === "running" || status === "draining";
    }

    function hasStoredResults() {
      return Boolean(state.summary && Number(state.summary.measuredCalls || 0) > 0);
    }

    function hasPreviousResults() {
      return hasStoredResults() || state.recentRuns.length > 0 || Boolean(state.viewingPreviousResults && state.receipt);
    }

    function hasCurrentRunReceipt() {
      return state.receiptMode === "current-run" && Boolean(state.coverageReceipt);
    }

    function renderPreviousResultsControl() {
      const line = $("previousResultsLine");
      const shouldShow = hasPreviousResults() && !hasCurrentRunReceipt() && !isCoverageRunActive();
      if (shouldShow) line.removeAttribute("hidden");
      else line.setAttribute("hidden", "");
    }

    function renderStageFromState() {
      if (!hasPreviousResults()) {
        state.viewingPreviousResults = false;
        state.receiptMode = "none";
        state.selectedReceiptRunId = null;
      }
      renderPreviousResultsControl();
      if (isCoverageRunActive()) {
        document.body.dataset.stage = "running";
      } else if (hasCurrentRunReceipt() || (state.viewingPreviousResults && hasPreviousResults())) {
        document.body.dataset.stage = "done";
      } else {
        document.body.dataset.stage = "empty";
      }
    }

    function isCoverageRunTerminal(run) {
      return run && ["completed", "killed", "failed", "aborted_before_calls"].includes(run.status);
    }

    function configuredProviders() {
      const setup = state.setup;
      if (!setup) return [];
      return PROVIDER_NAMES.filter((provider) => setup.providers[provider] && setup.providers[provider].configured);
    }

    function selectedCoverageProviders() {
      const configured = configuredProviders();
      if (state.providerScope === "all") return configured;
      return configured.includes(state.providerScope) ? [state.providerScope] : [];
    }

    function selectedCoverageGenerator() {
      return $("coverageGeneratorSelect").value || "built-in";
    }

    function selectedCoverageSpendCap() {
      const value = Number($("coverageSpendCapInput").value);
      return Number.isFinite(value) && value > 0 ? value : undefined;
    }

    function coverageRequestBody() {
      const body = { generator: selectedCoverageGenerator() };
      const selectedModels = selectedModelsForRequest();
      if (selectedModels.length) body.selectedModels = selectedModels;
      const spendCapUsd = selectedCoverageSpendCap();
      if (spendCapUsd !== undefined) body.spendCapUsd = spendCapUsd;
      return body;
    }

    function selectedModelsForRequest() {
      return selectedCoverageProviders().map((provider) => ({
        provider,
        model: selectedModelForProvider(provider),
      })).filter((entry) => entry.model);
    }

    function selectedModelForProvider(provider) {
      const selected = state.selectedModelsByProvider[provider];
      if (selected) return selected;
      const fallback = defaultModelForProvider(provider);
      if (fallback) state.selectedModelsByProvider[provider] = fallback;
      return fallback || "";
    }

    function defaultModelForProvider(provider) {
      const defaults = state.coverageOptions && state.coverageOptions.defaults
        ? state.coverageOptions.defaults.selectedModels || []
        : [];
      const defaultEntry = defaults.find((entry) => entry.provider === provider);
      if (defaultEntry) return defaultEntry.model;
      const first = providerModelOptions(provider)[0];
      return first ? first.model : "";
    }

    function providerModelOptions(provider) {
      return ((state.coverageOptions && state.coverageOptions.providerOptions) || [])
        .filter((option) => option.provider === provider);
    }

    function coverageRequestKey() {
      return JSON.stringify(coverageRequestBody());
    }

    function renderCoverageOptions(options) {
      state.coverageOptions = options;
      syncSelectedModelsFromOptions(options);
      renderProviderScope();
      renderModelPickers();
      renderAdvancedOptions();
      if (!options.runnable) {
        state.coverageEstimate = null;
        state.coverageEstimateRequestKey = null;
        $("runTestButton").disabled = true;
        $("priceTag").textContent = options.disabledReason === "provider_key_needed"
          ? "Waiting for a provider key"
          : "Price not known yet";
        $("priceSubtext").textContent = plainDisabledMessage(options.disabledMessage || "Estimate unavailable.");
        return;
      }
      const currentKey = coverageRequestKey();
      if (options.estimate && estimateMatchesCurrentRequest(options.estimate)) {
        state.coverageEstimate = {
          estimate: options.estimate,
          consentHash: options.estimate.estimateHash,
          consentToken: options.estimate.estimateHash,
          estimateLine: options.estimateLine,
          consent: null,
        };
        state.coverageEstimateRequestKey = currentKey;
        renderPriceTag(state.coverageEstimate);
        $("runTestButton").disabled = isCoverageRunActive();
      } else if (state.coverageEstimate && state.coverageEstimateRequestKey === currentKey) {
        renderPriceTag(state.coverageEstimate);
        $("runTestButton").disabled = isCoverageRunActive();
      } else {
        state.coverageEstimate = null;
        state.coverageEstimateRequestKey = null;
        renderPricePending();
        $("runTestButton").disabled = true;
      }
      scheduleCoverageEstimate(40);
    }

    function estimateMatchesCurrentRequest(estimate) {
      const body = coverageRequestBody();
      if (estimate.generator !== body.generator) return false;
      if (!sameSelectedModels(estimate.selectedModels || [], body.selectedModels || [])) return false;
      if (body.spendCapUsd !== undefined && Number(estimate.spendCapUsd) !== body.spendCapUsd) return false;
      return true;
    }

    function sameSelectedModels(left, right) {
      if (left.length !== right.length) return false;
      return left.every((entry, index) =>
        entry.provider === right[index].provider && entry.model === right[index].model
      );
    }

    function syncSelectedModelsFromOptions(options) {
      const configured = (options.setup && options.setup.configuredProviders) || [];
      for (const provider of configured) {
        const optionsForProvider = (options.providerOptions || []).filter((option) => option.provider === provider);
        if (!optionsForProvider.length) continue;
        const selected = state.selectedModelsByProvider[provider];
        if (!selected || !optionsForProvider.some((option) => option.model === selected)) {
          const defaultEntry = options.defaults && (options.defaults.selectedModels || []).find((entry) => entry.provider === provider);
          state.selectedModelsByProvider[provider] = defaultEntry ? defaultEntry.model : optionsForProvider[0].model;
        }
      }
      for (const provider of Object.keys(state.selectedModelsByProvider)) {
        if (!configured.includes(provider)) delete state.selectedModelsByProvider[provider];
      }
    }

    function renderModelPickers() {
      const panel = $("modelChoicePanel");
      const target = $("modelPickerList");
      const configured = configuredProviders();
      if (!configured.length) {
        panel.setAttribute("hidden", "");
        target.innerHTML = "";
        return;
      }
      panel.removeAttribute("hidden");
      const activeProviders = selectedCoverageProviders();
      target.innerHTML = configured.map((provider) => {
        const options = providerModelOptions(provider);
        if (!options.length) {
          return '<div class="model-row"><div class="model-copy"><span>' + escapeHtml(providerLabel(provider)) + '</span><span class="model-hint">No priced model available</span></div></div>';
        }
        const selected = selectedModelForProvider(provider);
        const disabled = !activeProviders.includes(provider) || isCoverageRunActive();
        const hint = modelTierHint(selected);
        return '<label class="model-row">' +
          '<span class="model-copy"><span>' + escapeHtml(providerLabel(provider)) + '</span><span class="model-hint" data-testid="model-tier-' + escapeHtml(provider) + '">' + escapeHtml(hint) + '</span></span>' +
          '<select data-model-picker="' + escapeHtml(provider) + '" data-testid="model-picker-' + escapeHtml(provider) + '" aria-label="' + escapeHtml(providerLabel(provider)) + ' model"' + (disabled ? ' disabled' : '') + '>' +
          options.map((option) => '<option value="' + escapeHtml(option.model) + '"' + (option.model === selected ? ' selected' : '') + '>' + escapeHtml(option.model + " - " + modelTierHint(option.model)) + '</option>').join("") +
          '</select>' +
        '</label>';
      }).join("");
      for (const select of target.querySelectorAll("[data-model-picker]")) {
        select.addEventListener("change", () => {
          state.selectedModelsByProvider[select.getAttribute("data-model-picker")] = select.value;
          renderModelPickers();
          invalidateCoverageEstimate();
        });
      }
    }

    function modelTierHint(model) {
      const text = String(model || "").toLowerCase();
      if (text.includes("nano") || text.includes("mini") || text.includes("haiku")) return "fast & cheap";
      if (
        text.includes("sonnet") ||
        text.includes("opus") ||
        text.includes("fable") ||
        text.includes("mythos") ||
        text === "gpt-5.4" ||
        text.startsWith("gpt-5.5") ||
        text.includes("gpt-4o")
      ) return "frontier";
      return "balanced";
    }

    function plainDisabledMessage(message) {
      if (/baseline not measured/i.test(message)) return "The local estimate source is not ready yet.";
      if (/provider key/i.test(message)) return "Provider key needed before the test can run.";
      if (/pricing/i.test(message)) return "A model price is not known yet.";
      return message;
    }

    function renderProviderScope() {
      for (const button of document.querySelectorAll("[data-provider-scope]")) {
        const value = button.getAttribute("data-provider-scope");
        button.setAttribute("aria-pressed", value === state.providerScope ? "true" : "false");
        if (value !== "all") {
          button.disabled = !configuredProviders().includes(value);
        } else {
          button.disabled = configuredProviders().length === 0;
        }
      }
    }

    function renderAdvancedOptions() {
      const options = state.coverageOptions;
      const generatorSelect = $("coverageGeneratorSelect");
      const capInput = $("coverageSpendCapInput");
      generatorSelect.disabled = isCoverageRunActive();
      capInput.disabled = isCoverageRunActive();
      if (options && options.defaults) {
        if (!generatorSelect.value) generatorSelect.value = options.defaults.generator || "built-in";
      }
    }

    function renderPriceTag(payload) {
      if (!payload || !payload.estimate) return;
      $("priceTag").textContent = "Ready to spend ~" + formatEstimateUsd(payload.estimate.estimatedUsd) + " to measure everything on " + selectedModelsLabel(payload.estimate.selectedModels) + ".";
      $("priceTag").dataset.estimateUsd = String(payload.estimate.estimatedUsd);
      $("priceTag").dataset.consentHash = payload.consentHash || payload.estimate.estimateHash || "";
      $("priceSubtext").textContent = "The full battery always runs. Model choice only changes the price tier.";
    }

    function renderPricePending() {
      if (!state.coverageOptions || !state.coverageOptions.runnable || selectedCoverageProviders().length === 0) return;
      $("priceTag").textContent = "Updating price...";
      $("priceTag").dataset.estimateUsd = "";
      $("priceTag").dataset.consentHash = "";
      $("priceSubtext").textContent = "Checking the selected models before the run can start.";
    }

    function invalidateCoverageEstimate() {
      state.coverageEstimate = null;
      state.coverageEstimateRequestKey = null;
      state.agentInstallAcknowledgedHash = null;
      renderPricePending();
      $("runTestButton").disabled = true;
      renderCoverageConsent();
      scheduleCoverageEstimate(20);
    }

    function scheduleCoverageEstimate(delay) {
      if (state.coverageEstimateTimer) window.clearTimeout(state.coverageEstimateTimer);
      state.coverageEstimateTimer = window.setTimeout(() => {
        state.coverageEstimateTimer = null;
        refreshCoverageEstimate().catch((error) => {
          $("priceTag").textContent = "Price not known yet";
          $("priceSubtext").textContent = error.message || "Estimate failed.";
          $("runTestButton").disabled = true;
        });
      }, delay == null ? 250 : delay);
    }

    async function refreshCoverageEstimate() {
      if (!state.coverageOptions || !state.coverageOptions.runnable || isCoverageRunActive()) return;
      if (selectedCoverageProviders().length === 0) return;
      const body = coverageRequestBody();
      if (!body.selectedModels || body.selectedModels.length === 0) return;
      const requestKey = JSON.stringify(body);
      const response = await managementFetch("/api/coverage-test/estimate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      const payload = await response.json();
      if (requestKey !== coverageRequestKey()) return;
      state.coverageEstimate = payload;
      state.coverageEstimateRequestKey = requestKey;
      state.agentInstallAcknowledgedHash = null;
      renderPriceTag(payload);
      $("runTestButton").disabled = false;
      renderCoverageConsent();
    }

    async function openCoverageConsent() {
      await savePendingKeysNow();
      if (!state.coverageEstimate || state.coverageEstimateRequestKey !== coverageRequestKey()) await refreshCoverageEstimate();
      renderCoverageConsent();
      showDialog($("consentDialog"));
    }

    function closeCoverageConsent() {
      closeDialog($("consentDialog"));
    }

    function renderCoverageConsent() {
      const payload = state.coverageEstimate;
      if (!payload || !payload.estimate) return;
      const estimate = payload.estimate;
      $("consentTitle").textContent = "Ready to spend ~" + formatEstimateUsd(estimate.estimatedUsd) + " to measure everything on " + selectedModelsLabel(estimate.selectedModels) + "?";
      $("consentEstimatedUsd").textContent = formatEstimateUsd(estimate.estimatedUsd);
      $("consentSpendCapDisplay").textContent = formatEstimateUsd(estimate.spendCapUsd);
      $("consentProviders").textContent = selectedModelsLabel(estimate.selectedModels);
      $("consentFingerprint").textContent = payload.consentHash || estimate.estimateHash;
      $("consentEstimateLines").innerHTML = estimateLinesHtml(estimate);
      const pricing = (estimate.pricing || []).map((entry) => '<div class="info-block">' +
        '<strong>' + escapeHtml(providerLabel(entry.provider) + " " + entry.model) + '</strong>' +
        '<span class="small muted">Estimate source: ' + escapeHtml(entry.pricingVersion + " " + entry.source) + '</span>' +
        '</div>').join("");
      const baseline = payload.consent && payload.consent.baselineProvenance
        ? payload.consent.baselineProvenance
        : null;
      $("pricingDetailsPanel").innerHTML =
        '<div class="info-block"><strong>Estimate only</strong><span class="small muted">Test version ' + escapeHtml(estimate.suiteVersion) + ' · Estimate source ' + escapeHtml(estimate.baselineVersion) + '</span><span class="small muted">These estimate numbers are not measured results.</span></div>' +
        (baseline ? '<div class="info-block"><strong>Estimate source</strong><span class="small muted">' + escapeHtml(baseline.sourcePath || "") + '</span><span class="small muted">' + escapeHtml(baseline.notes || "") + '</span></div>' : "") +
        pricing;
      renderAgentInstallConsent(payload.agentInstall || null);
      updateCoverageConsentStartEnabled();
    }

    function estimateLinesHtml(estimate) {
      const lines = (estimate.estimatedUsdByModel || []).map((entry) =>
        '<div class="estimate-line"><span>' + escapeHtml(providerLabel(entry.provider) + " " + entry.model + " · " + modelTierHint(entry.model)) + '</span><strong>' + formatEstimateUsd(entry.estimatedUsd) + '</strong></div>'
      ).join("");
      return lines + '<div class="estimate-line"><span>Total estimate</span><strong>' + formatEstimateUsd(estimate.estimatedUsd) + '</strong></div>';
    }

    function selectedModelsLabel(selectedModels) {
      return (selectedModels || []).map((entry) => providerLabel(entry.provider) + " " + entry.model).join(", ") || "the selected models";
    }

    function renderAgentInstallConsent(install) {
      const section = $("agentInstallConsent");
      const details = $("agentInstallDetails");
      const ack = $("agentInstallAck");
      if (!install) {
        section.classList.remove("visible");
        section.setAttribute("hidden", "");
        section.removeAttribute("data-consent-hash");
        details.innerHTML = "";
        ack.checked = false;
        state.agentInstallAcknowledgedHash = null;
        return;
      }
      section.removeAttribute("hidden");
      section.classList.add("visible");
      section.setAttribute("data-consent-hash", install.consentHash || "");
      ack.checked = state.agentInstallAcknowledgedHash === install.consentHash;
      const packages = (install.packages || []).map((entry) =>
        '<div class="info-block">' +
        '<strong>' + escapeHtml(entry.name + "@" + entry.version) + '</strong>' +
        '<span class="small muted">Package: ' + escapeHtml(entry.tarballUrl) + '</span>' +
        '<span class="small muted">SRI: ' + escapeHtml(entry.integrity) + '</span>' +
        '<span class="small muted">Unpacked size: ' + integer.format(Number(entry.unpackedSize || 0)) + ' bytes</span>' +
        '</div>'
      ).join("");
      details.innerHTML =
        '<div class="info-block"><strong>' + escapeHtml(install.agent.name + "@" + install.agent.version) + '</strong>' +
        '<span class="small muted">Bench version: ' + escapeHtml(install.benchVersion || "") + '</span>' +
        '<span class="small muted">Platform: ' + escapeHtml(install.platform || "") + '</span>' +
        '<span class="small muted">Install path: ' + escapeHtml(install.installRoot || "") + '</span>' +
        '<span class="small muted">Why: ' + escapeHtml(install.whyText || "") + '</span>' +
        '<span class="small muted">Run fingerprint: ' + escapeHtml(install.consentHash || "") + '</span></div>' +
        packages;
    }

    function updateCoverageConsentStartEnabled() {
      const payload = state.coverageEstimate;
      const install = payload && payload.agentInstall;
      $("consentStartButton").disabled = Boolean(install && state.agentInstallAcknowledgedHash !== install.consentHash);
    }

    async function startCoverageRun() {
      if (!state.coverageEstimate || state.coverageEstimateRequestKey !== coverageRequestKey()) await refreshCoverageEstimate();
      const payload = state.coverageEstimate;
      if (!payload || !payload.consentHash) throw new Error("Estimate required.");
      const body = {
        ...coverageRequestBody(),
        consentHash: payload.consentHash,
        displayedEstimateUsd: payload.estimate.estimatedUsd,
        displayedConsentHash: payload.consentHash,
      };
      if (payload.agentInstall && payload.agentInstall.consentHash) {
        if (state.agentInstallAcknowledgedHash !== payload.agentInstall.consentHash) {
          throw new Error("Agent install consent must be accepted before starting.");
        }
        body.agentInstallConsentHash = state.agentInstallAcknowledgedHash;
      }
      const response = await managementFetch("/api/coverage-test/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      const started = await response.json();
      state.viewingPreviousResults = false;
      state.receiptMode = "none";
      state.selectedReceiptRunId = null;
      state.coverageReceipt = null;
      closeCoverageConsent();
      renderCoverageRun(started.run);
      connectCoverageEvents(started.run.runId);
    }

    function connectCoverageEvents(runId) {
      if (state.coverageEvents && state.coverageEventsRunId === runId) return;
      if (state.coverageEvents) state.coverageEvents.close();
      if (!window.EventSource) return;
      const source = new EventSource("/api/coverage-test/runs/" + encodeURIComponent(runId) + "/events");
      state.coverageEvents = source;
      state.coverageEventsRunId = runId;
      source.addEventListener("snapshot", (event) => {
        const run = JSON.parse(event.data);
        renderCoverageRun(run);
        if (run.receiptReady || (isCoverageRunTerminal(run) && run.status === "failed")) source.close();
      });
      source.onerror = () => {
        source.close();
        if (state.coverageEvents === source) {
          state.coverageEvents = null;
          state.coverageEventsRunId = null;
        }
      };
    }

    function renderCoverageRun(run) {
      state.coverageRun = run;
      state.viewingPreviousResults = false;
      state.receiptMode = "none";
      state.selectedReceiptRunId = null;
      state.coverageReceipt = null;
      renderPreviousResultsControl();
      document.body.dataset.stage = "running";
      const progress = run.progress || {};
      const estimate = run.estimate || {};
      $("runningHeadline").textContent = run.status === "draining" ? "Stopping the test" : run.status === "killed" ? "Test stopped" : "Running the test";
      $("runningSpendLine").textContent = "About " + formatEstimateUsd(progress.estimatedStartedSpendUsd || progress.actualSpendUsd || 0) + " in calls started so far of about " + formatEstimateUsd(estimate.estimatedUsd || 0) + " estimated.";
      $("runningSurfaces").textContent = integer.format(progress.surfacesWatchedCount || 0) + " / " + integer.format(progress.totalSurfaceCount || 0);
      $("runningCalls").textContent = integer.format(progress.providerCallsStarted || progress.measuredCalls || 0);
      $("runningCap").textContent = formatUsd(progress.capRemainingUsd || 0);
      $("runningFingerprint").textContent = run.consentHash || "waiting";
      const plannedCalls = progress.plannedCallCount || 0;
      const completedCalls = progress.providerCallsCompleted || 0;
      const startedCalls = progress.providerCallsStarted || 0;
      const weightedCalls = completedCalls + Math.max(0, startedCalls - completedCalls) * 0.35;
      const terminal = isCoverageRunTerminal(run) || run.receiptReady;
      const progressPercent = terminal
        ? 100
        : Math.max(4, Math.min(95, plannedCalls > 0 ? Math.round((weightedCalls / plannedCalls) * 100) : 4));
      $("progressFill").style.width = progressPercent + "%";
      $("progressTrack").setAttribute("aria-valuenow", String(progressPercent));
      $("currentStep").textContent = "Current step: " + humanStep(progress.tasks || []);
      $("taskList").innerHTML = (progress.tasks || []).map((task) =>
        '<div class="task-row" data-testid="task-row"><span><strong>' + escapeHtml(providerLabel(task.provider)) + '</strong> ' + escapeHtml(humanTaskLabel(task.label || task.taskId)) +
        (task.status === "skipped" && task.statusReason ? '<span class="small muted"> — ' + escapeHtml(task.statusReason) + '</span>' : '') +
        (task.status === "failed" && task.statusReason ? '<span class="small muted"> — ' + escapeHtml(task.statusReason) + '</span>' : '') +
        '</span><span class="badge ' + taskBadgeClass(task.status) + '">' + escapeHtml(humanTaskStatus(task.status)) + '</span></div>'
      ).join("");
      $("abortRunButton").disabled = !isCoverageRunActive();
      if (run.status === "draining") {
        $("abortCaveat").textContent = "Stopping after in-flight provider calls finish. Already-started provider calls may still be billed.";
      } else {
        $("abortCaveat").textContent = "Already-started provider calls may still be billed if you abort.";
      }
      if (run.receiptReady) {
        fetchCoverageReceipt(run.runId).catch((error) => {
          $("refreshStatus").textContent = error.message || "Receipt failed.";
        });
      }
      if (run.fallbackOffer) {
        $("priceSubtext").textContent = run.fallbackOffer.label + ": agent install failed before provider calls. Use Built-in test in Advanced options.";
      }
    }

    function humanStep(tasks) {
      const active = tasks.find((task) => task.status === "running") || tasks.find((task) => task.status === "pending");
      if (!active) return "checking structured outputs";
      return humanTaskLabel(active.label || active.taskId);
    }

    function humanTaskLabel(label) {
      const text = String(label || "").replaceAll("_", " ").toLowerCase();
      if (text.includes("json") || text.includes("schema") || text.includes("structured")) return "checking structured outputs";
      if (text.includes("tool")) return "checking tool calls";
      if (text.includes("cache")) return "checking cache discounts";
      if (text.includes("latency") || text.includes("timeout")) return "checking response time";
      if (text.includes("stream")) return "checking streamed answers";
      if (text.includes("anthropic")) return "checking Anthropic token counts";
      if (text.includes("drift")) return "checking answer changes";
      if (text.includes("refusal") || text.includes("filter")) return "checking refused or filtered answers";
      return text || "checking structured outputs";
    }

    function humanTaskStatus(status) {
      if (status === "completed") return "done";
      if (status === "running") return "running";
      if (status === "failed") return "needs review";
      if (status === "skipped") return "skipped";
      return "waiting";
    }

    function taskBadgeClass(status) {
      return status === "completed" ? "good" : status === "running" ? "info" : status === "failed" ? "attn" : "";
    }

    async function abortCoverageRun() {
      if (!state.coverageRun) return;
      const response = await managementFetch("/api/coverage-test/runs/" + encodeURIComponent(state.coverageRun.runId) + "/abort", { method: "POST" });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      renderCoverageRun(await response.json());
    }

    async function fetchCoverageReceipt(runId) {
      const response = await fetch("/api/coverage-test/runs/" + encodeURIComponent(runId) + "/receipt");
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      state.coverageReceipt = await response.json();
      state.receipt = state.coverageReceipt;
      state.viewingPreviousResults = false;
      state.receiptMode = "current-run";
      state.selectedReceiptRunId = runId;
      await refresh();
      document.body.dataset.stage = "done";
    }

    function renderSummary(payload) {
      state.summary = payload.summary;
      state.setup = payload.setup;
      renderSetup(payload.setup);
      renderReceiptStage();
      renderStageFromState();
    }

    function renderSetup(setup) {
      $("setupPath").textContent = setup.configPath ? "Saved locally" : "";
      renderProviderMeta("openai", setup.providers.openai);
      renderProviderMeta("anthropic", setup.providers.anthropic);
      renderProviderMeta("gemini", setup.providers.gemini);
      renderProviderMeta("openrouter", setup.providers.openrouter);
      $("keyPanel").classList.toggle("compact-key-panel", configuredProviders().length > 0);
      $("benchKeyValue").textContent = setup.maskedBenchKey || "No local key yet";
      $("copyKeyButton").disabled = !setup.canRevealBenchKey;
      $("copyKeyButton").textContent = "Reveal/copy";
      const snippets = [];
      for (const provider of PROVIDER_NAMES) {
        if (setup.providers[provider].configured) snippets.push(snippetBlock(provider));
      }
      $("snippetList").innerHTML = snippets.join("");
      renderProviderScope();
      renderReceiptDetails();
    }

    function renderProviderMeta(provider, info) {
      const target = $(provider + "Meta");
      const input = $(provider + "KeyInput");
      if (!info.configured) {
        input.hidden = false;
        input.disabled = false;
        target.textContent = "Not added yet";
        target.className = "provider-meta";
        return;
      }
      input.value = "";
      input.hidden = true;
      input.disabled = true;
      const source = info.source === "env" ? "environment override" : "saved locally";
      target.innerHTML = '<span class="badge good">' + escapeHtml(displaySecretLabel(info.maskedKey || "configured")) + '</span><span class="small muted">' + source + '</span>';
    }

    function snippetBlock(provider) {
      return '<div class="info-block"><h3>' + providerLabel(provider) + '</h3><pre>' + escapeHtml(snippetFor(provider)) + '</pre></div>';
    }

    function renderRows(payload) {
      state.rows = payload.rows || [];
      renderReceiptStage();
    }

    function renderCalls(payload) {
      state.calls = payload.calls || [];
      renderReceiptDetails();
    }

    function renderReceipt(payload) {
      state.receipt = payload;
      state.recomputedReceipt = null;
      renderReceiptStage();
    }

    function renderRuns(payload) {
      state.recentRuns = Array.isArray(payload && payload.runs) ? payload.runs : [];
      renderPreviousRunList();
      renderPreviousResultsControl();
    }

    function receiptModeCopy() {
      if (state.receiptMode === "history") {
        return {
          label: "Previous results",
          title: "Previous results",
          note: "Saved results from earlier calls on this computer. Run test for a fresh receipt.",
        };
      }
      if (state.receiptMode === "previous-run") {
        return {
          label: "Previous run receipt",
          title: "Previous run receipt",
          note: "A saved receipt from an earlier run. Previous results remain available below.",
        };
      }
      return { label: "Receipt", title: "Receipt", note: "" };
    }

    function renderReceiptStage() {
      const summary = state.summary;
      if (!summary) return;
      const copy = receiptModeCopy();
      $("receiptModeLabel").textContent = copy.label;
      $("receiptLedgerTitle").textContent = copy.title;
      $("receiptModeNote").textContent = copy.note;
      if (copy.note) $("receiptModeNote").removeAttribute("hidden");
      else $("receiptModeNote").setAttribute("hidden", "");
      const moneyTotals = summary.moneyTotals || {
        standardLossUsd: summary.standardLossUsd || 0,
        providerRecognizedUsd: summary.providerRecognizedUsd || 0,
        recognitionGapUsd: summary.recognitionGapUsd || summary.unrecognizedUsd || 0,
        providerSpendUsd: summary.providerSpendUsd || 0,
      };
      const durationTotals = summary.durationTotals || {
        timeLossMs: 0,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: 0,
        dollarTranslationUsd: 0,
      };
      const pricingUnknownCount = Number(summary.pricingUnknownCount || 0);
      const hasSummarySpendShareLine = Object.prototype.hasOwnProperty.call(summary, "moneyLossObservedSpendLine");
      const spendShareLine = pricingUnknownCount > 0 && Number(moneyTotals.standardLossUsd || 0) === 0
        ? null
        : hasSummarySpendShareLine
        ? (typeof summary.moneyLossObservedSpendLine === "string" ? summary.moneyLossObservedSpendLine : null)
        : moneyLossObservedSpendLine(moneyTotals.standardLossUsd, summary.providerSpendUsd);
      $("receiptSpentHeadline").textContent = formatUsd(summary.providerSpendUsd);
      $("receiptMoneyLossHeadline").textContent = moneyLossHeadlineValue(moneyTotals.standardLossUsd, pricingUnknownCount, spendShareLine);
      const invoiceCheckExposure = invoiceCheckExposureAmount(summary.exposures || []);
      $("receiptInvoiceCheckExposureHeadline").textContent = formatExposureUsd(invoiceCheckExposure);
      $("receiptMoneyLossSpendShare").textContent = spendShareLine || "";
      $("receiptMoneyLossSpendShare").hidden = !spendShareLine;
      $("receiptTimeLossHeadline").textContent = formatApproxTimeLost(durationTotals.timeLossMs);
      $("receiptStandardLoss").textContent = formatUsd(moneyTotals.standardLossUsd);
      $("receiptRecognized").textContent = formatUsd(moneyTotals.providerRecognizedUsd);
      $("receiptGap").textContent = formatUsd(moneyTotals.recognitionGapUsd || moneyTotals.unrecognizedUsd);
      $("receiptDurationLoss").textContent = formatApproxTimeLost(durationTotals.timeLossMs);
      $("receiptInvoiceCheckExposure").textContent = formatExposureUsd(invoiceCheckExposure);
      $("receiptRecognizedTime").textContent = formatApproxTimeLost(durationTotals.providerRecognizedTimeLossMs);
      $("receiptTimeGap").textContent = formatApproxTimeLost(durationTotals.recognitionGapTimeMs);
      $("receiptDurationTranslation").textContent = "≈ " + formatUsd(durationTotals.dollarTranslationUsd);
      $("receiptProviderSpend").textContent = formatUsd(summary.providerSpendUsd);
      $("receiptCalls").textContent = integer.format(summary.measuredCalls);
      $("receiptFailures").textContent = integer.format(summary.failureCount);
      $("receiptSurfaces").textContent = integer.format(summary.coverage.watchedCount) + " / " + integer.format(summary.coverage.totalSurfaceCount);
      renderActionCards(state.rows || [], summary.exposures || []);
      renderPreviousRunList();
      renderReceiptDetails();
    }

    async function openPreviousResults() {
      if (!hasPreviousResults()) return;
      state.viewingPreviousResults = true;
      state.receiptMode = "history";
      state.selectedReceiptRunId = null;
      state.coverageReceipt = null;
      await refresh();
      activateReceiptDetailsTab("signals");
      renderStageFromState();
      window.scrollTo({ top: 0 });
    }

    async function openPreviousRunReceipt(runId) {
      state.viewingPreviousResults = true;
      state.receiptMode = "previous-run";
      state.selectedReceiptRunId = runId;
      state.coverageReceipt = null;
      await refresh();
      applyReceiptFallbackFromCurrentReceipt();
      activateReceiptDetailsTab("signals");
      renderStageFromState();
      window.scrollTo({ top: 0 });
    }

    function renderPreviousRunList() {
      const target = $("previousRunList");
      if (!target) return;
      if (!state.viewingPreviousResults || !state.recentRuns.length) {
        target.setAttribute("hidden", "");
        target.innerHTML = "";
        return;
      }
      const historySelected = state.receiptMode === "history";
      target.removeAttribute("hidden");
      target.innerHTML =
        '<p class="label">Saved receipts</p>' +
        '<div class="run-history-actions">' +
        '<button class="secondary run-history-button" type="button" data-testid="previous-history-button" data-previous-history aria-pressed="' + (historySelected ? "true" : "false") + '"><span>All previous results</span><span class="small muted">Combined history</span></button>' +
        state.recentRuns.map((run) => {
          const selected = state.receiptMode === "previous-run" && state.selectedReceiptRunId === run.runId;
          return '<button class="secondary run-history-button" type="button" data-testid="previous-run-receipt" data-previous-run-id="' + escapeHtml(run.runId || "") + '" aria-pressed="' + (selected ? "true" : "false") + '">' +
            '<span>' + escapeHtml(runStartedLabel(run.startedAt)) + '</span>' +
            '<span class="small muted">' + escapeHtml(runSummaryLabel(run)) + '</span>' +
          '</button>';
        }).join("") +
        '</div>';
      const historyButton = target.querySelector("[data-previous-history]");
      if (historyButton) historyButton.addEventListener("click", () => {
        openPreviousResults().catch((error) => {
          $("refreshStatus").textContent = error.message || "Could not open previous results.";
        });
      });
      for (const button of target.querySelectorAll("[data-previous-run-id]")) {
        button.addEventListener("click", () => {
          const runId = button.getAttribute("data-previous-run-id") || "";
          openPreviousRunReceipt(runId).catch((error) => {
            $("refreshStatus").textContent = error.message || "Could not open saved receipt.";
          });
        });
      }
    }

    function runStartedLabel(value) {
      if (!value) return "Saved run";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Saved run";
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " +
        date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }

    function runSummaryLabel(run) {
      const models = (run.selectedModels || []).map((entry) => providerLabel(entry.provider) + " " + entry.model).join(", ");
      const calls = run.measuredCalls === undefined ? "" : integer.format(run.measuredCalls) + " calls";
      const loss = run.standardLossUsd === undefined ? "" : formatUsd(run.standardLossUsd) + " loss";
      return [models, calls, loss].filter(Boolean).join(" · ") || "Receipt saved locally";
    }

    function receiptBundle() {
      return state.receipt && state.receipt.bundle ? state.receipt.bundle : null;
    }

    function activeExportReceiptBundle() {
      return state.recomputedReceipt && state.recomputedReceipt.bundle ? state.recomputedReceipt.bundle : receiptBundle();
    }

    function activeExportReceiptText() {
      if (state.recomputedReceipt && state.recomputedReceipt.bundle) {
        return JSON.stringify(state.recomputedReceipt.bundle, null, 2);
      }
      return state.receipt && state.receipt.compactText ? state.receipt.compactText : "";
    }

    function jsonClone(value) {
      if (value === undefined) return undefined;
      return JSON.parse(JSON.stringify(value));
    }

    function sanitizeReceiptFilePart(value) {
      return String(value || "receipt")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 96) || "receipt";
    }

    function receiptIdentity(bundle) {
      return String(
        (bundle && bundle.receiptId) ||
        (bundle && bundle.run && bundle.run.runId) ||
        (bundle && bundle.generatedAt) ||
        (bundle && bundle.title) ||
        "receipt"
      );
    }

    function recomputedReceiptBundleForEdit(index, row) {
      const source = receiptBundle();
      if (!source) return null;
      const now = new Date().toISOString();
      const sourceId = receiptIdentity(source);
      const bundle = jsonClone(source);
      bundle.rows = jsonClone(state.rows);
      bundle.totals = bundle.totals || {};
      bundle.totals.duration = durationTotalsFromRows(bundle.totals.duration || {}, bundle.rows);
      bundle.recomputedReceiptId = "recomputed-" + sanitizeReceiptFilePart(sourceId) + "-" + sanitizeReceiptFilePart(now);
      bundle.recomputedFromReceiptId = sourceId;
      bundle.recomputedAt = now;
      bundle.editedAssumptionSnapshot = {
        rowIndex: index,
        rowCode: row.code || "",
        failureClass: row.failureClass || "",
        thresholdSnapshot: jsonClone(row.thresholdSnapshot || null),
        rateSnapshot: jsonClone(row.rateSnapshot || null),
      };
      return bundle;
    }

    function receiptDownloadFilename(bundle) {
      if (bundle && bundle.recomputedReceiptId) {
        return "inferock-bench-" + sanitizeReceiptFilePart(bundle.recomputedReceiptId) + ".json";
      }
      return "inferock-bench-receipt.json";
    }

    function applyReceiptFallbackFromCurrentReceipt() {
      const fallback = summaryFromReceiptBundle(receiptBundle());
      if (!fallback) return;
      if (!state.summary || Number(state.summary.measuredCalls || 0) === 0) state.summary = fallback;
      if ((!state.rows || state.rows.length === 0) && fallback.rows.length > 0) state.rows = fallback.rows;
      renderReceiptStage();
      renderStageFromState();
    }

    function summaryFromReceiptBundle(bundle) {
      if (!bundle || !bundle.totals) return null;
      const totals = bundle.totals || {};
      const moneyTotals = totals.money || {
        standardLossUsd: Number(totals.standardLossUsd || 0),
        providerRecognizedUsd: Number(totals.providerRecognizedUsd || 0),
        recognitionGapUsd: Number(totals.recognitionGapUsd || totals.unrecognizedUsd || 0),
        unrecognizedUsd: Number(totals.unrecognizedUsd || totals.recognitionGapUsd || 0),
        providerSpendUsd: Number(totals.providerSpendUsd || 0),
      };
      const durationTotals = totals.duration || {
        timeLossMs: 0,
        providerRecognizedTimeLossMs: 0,
        recognitionGapTimeMs: 0,
        dollarTranslationUsd: 0,
        rate: (bundle.assumptions && bundle.assumptions.timeValueRate) || {},
        thresholds: (bundle.assumptions && bundle.assumptions.activeLatencySegments) || [],
      };
      const run = bundle.run || {};
      return {
        period: bundle.period || { since: run.startedAt || null, until: run.endedAt || bundle.generatedAt || new Date().toISOString() },
        measuredCalls: Number(totals.measuredCalls || 0),
        failureCount: Number(totals.failures || totals.failureCount || 0),
        providerSpendUsd: Number(totals.providerSpendUsd || 0),
        moneyTotals,
        durationTotals,
        standardLossUsd: Number(moneyTotals.standardLossUsd || 0),
        providerRecognizedUsd: Number(moneyTotals.providerRecognizedUsd || 0),
        recognitionGapUsd: Number(moneyTotals.recognitionGapUsd || moneyTotals.unrecognizedUsd || 0),
        unrecognizedUsd: Number(moneyTotals.unrecognizedUsd || moneyTotals.recognitionGapUsd || 0),
        totalLostUsd: Number(moneyTotals.standardLossUsd || 0),
        pricingUnknownCount: Number(totals.pricingUnknownCount || 0),
        exposures: Array.isArray(bundle.exposures) ? bundle.exposures : [],
        rows: Array.isArray(bundle.rows) ? bundle.rows : [],
        measures: Array.isArray(bundle.measures) ? bundle.measures : [],
        coverage: bundle.coverage || { surfaces: [], watchedCount: 0, totalSurfaceCount: 0, signalCount: 0, notOpenableCount: 0 },
        slaAssumptions: bundle.assumptions || { impactFooterLines: [] },
      };
    }

    function renderActionCards(rows, exposures) {
      const target = $("actionCards");
      const exposureCards = exposureActionCardsHtml(exposures || []);
      if (!rows.length && !exposureCards) {
        const coverage = state.summary && state.summary.coverage;
        target.innerHTML = '<article class="action-card" data-testid="no-action-card"><h3>No action needed from this run.</h3><p class="small muted">Surfaces watched ' +
          integer.format((coverage && coverage.watchedCount) || 0) + '/' + integer.format((coverage && coverage.totalSurfaceCount) || 0) +
          '. View details for any checks that could not be watched.</p><button type="button" data-action-details>View details</button></article>';
        const button = target.querySelector("[data-action-details]");
        if (button) button.addEventListener("click", () => openDetails("all"));
        return;
      }
      target.innerHTML = exposureCards + rows.slice(0, 6).map((row, index) => {
        const action = actionCopyForRow(row);
        const gapValue = Number(row.recognitionGapUsd ?? row.unrecognizedUsd ?? 0);
        const amountLabel = row.primaryValueKind === "time_loss"
          ? formatApproxTimeLost(row.timeLossMs || 0) + " time lost"
          : gapValue > 0
            ? formatUsd(gapValue) + " gap"
            : formatUsd(row.standardLossUsd || 0) + " measured";
        const secondary = row.primaryValueKind === "time_loss" && row.dollarTranslationUsd !== null && row.dollarTranslationUsd !== undefined
          ? '<p class="small muted">approx ' + escapeHtml(formatUsd(row.dollarTranslationUsd)) + ' at your rate (edit)</p>'
          : '';
        const editControls = isEditableLatencyTimeRow(row)
          ? latencyEditControlsHtml(row, index)
          : '';
        const providerLine = row.providerRecognitionLine
          ? '<p class="small muted">' + escapeHtml(row.providerRecognitionLine) + '</p>'
          : '';
        return '<article class="action-card" data-testid="action-card">' +
          '<div class="card-head"><h3>' + escapeHtml(action.title) + '</h3><span class="gap-amount">' + escapeHtml(amountLabel) + '</span></div>' +
          '<p class="small">' + escapeHtml(action.next) + '</p>' +
          secondary +
          editControls +
          providerLine +
          '<button class="link" type="button" data-proof-index="' + index + '" data-testid="view-proof-' + index + '">View proof</button>' +
        '</article>';
      }).join("");
      for (const button of target.querySelectorAll("[data-proof-index]")) {
        button.addEventListener("click", () => {
          const row = rows[Number(button.getAttribute("data-proof-index"))];
          openDetails("proof", row);
        });
      }
      for (const input of target.querySelectorAll("[data-latency-threshold-index]")) {
        input.addEventListener("change", () => {
          const index = Number(input.getAttribute("data-latency-threshold-index"));
          applyLatencyThresholdEdit(index, Number(input.value)).catch((error) => {
            $("refreshStatus").textContent = error.message || "Could not update latency threshold.";
          });
        });
      }
      for (const input of target.querySelectorAll("[data-latency-rate-index]")) {
        input.addEventListener("change", () => {
          const index = Number(input.getAttribute("data-latency-rate-index"));
          applyLatencyRateEdit(index, Number(input.value)).catch((error) => {
            $("refreshStatus").textContent = error.message || "Could not update time value rate.";
          });
        });
      }
    }

    function exposureActionCardsHtml(exposures) {
      return (exposures || [])
        .filter((exposure) => Number(exposure.amount || 0) > 0 && Number(exposure.count || 0) > 0)
        .map((exposure) => {
          const amount = formatExposureUsd(exposure.amount);
          const count = integer.format(exposure.count || 0) + " invoice exposure" + ((exposure.count || 0) === 1 ? "" : "s");
          const title = exposure.class === "cache_discount_at_risk"
            ? "Cache discount invoice-check exposure"
            : String(exposure.class || "Invoice-check exposure").replaceAll("_", " ");
          const guidance = exposure.guidance || "verify your invoice";
          return '<article class="action-card exposure-action-card" data-testid="exposure-card">' +
            '<div class="card-head"><h3>' + escapeHtml(title) + '</h3><span class="gap-amount">' + escapeHtml(amount + ' invoice-check exposure') + '</span></div>' +
            '<p class="small">' + escapeHtml(count + ' - ' + guidance + '.') + '</p>' +
            '<p class="small muted">This is invoice-check exposure, not standard-loss or recognition-gap dollars.</p>' +
          '</article>';
        }).join("");
    }

    function isEditableLatencyTimeRow(row) {
      return row.primaryValueKind === "time_loss" && (
        row.failureClass === "latency" ||
        row.failureClass === "latency_threshold" ||
        row.code === "LATENCY_BILLED" ||
        row.code === "LATENCY_SLOW_RESPONSE"
      );
    }

    function latencyEditControlsHtml(row, index) {
      const threshold = row.thresholdSnapshot || {};
      const rate = row.rateSnapshot || {};
      const acceptableMs = Number(threshold.acceptableMs || threshold.acceptableStartMs || 0);
      const usdPerHour = Number(rate.usdPerHour || (state.summary && state.summary.durationTotals && state.summary.durationTotals.rate && state.summary.durationTotals.rate.usdPerHour) || 0);
      return '<div class="time-edit-grid" data-testid="latency-edit-controls-' + index + '">' +
        '<label class="time-edit-field"><span>Threshold ms</span><input type="number" min="0" step="1000" value="' + escapeHtml(String(acceptableMs)) + '" data-latency-threshold-index="' + index + '" data-testid="latency-threshold-input-' + index + '" aria-label="Latency threshold milliseconds"></label>' +
        '<label class="time-edit-field"><span>Rate $/hr</span><input type="number" min="0" step="1" value="' + escapeHtml(String(usdPerHour)) + '" data-latency-rate-index="' + index + '" data-testid="latency-rate-input-' + index + '" aria-label="Time value rate dollars per hour"></label>' +
      '</div>';
    }

    async function applyLatencyThresholdEdit(index, acceptableMs) {
      if (!Number.isFinite(acceptableMs) || acceptableMs < 0) throw new Error("Threshold must be a non-negative number.");
      const row = state.rows[index];
      if (!row) return;
      const response = await managementFetch("/api/reprice-latency-row", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          row,
          threshold: {
            acceptableStartMs: acceptableMs,
            acceptableMsPerOutputToken: 0,
          },
        }),
      });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      const payload = await response.json();
      applyEditedRow(index, payload.row);
    }

    async function applyLatencyRateEdit(index, rateUsdPerHour) {
      if (!Number.isFinite(rateUsdPerHour) || rateUsdPerHour < 0) throw new Error("Rate must be a non-negative number.");
      const row = state.rows[index];
      if (!row) return;
      const response = await managementFetch("/api/reprice-latency-row", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          row,
          rateUsdPerHour,
        }),
      });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      const payload = await response.json();
      applyEditedRow(index, payload.row);
    }

    function applyEditedRow(index, row) {
      if (!row) return;
      state.rows = state.rows.map((entry, entryIndex) => entryIndex === index ? row : entry);
      if (state.summary) {
        state.summary.rows = state.rows;
        state.summary.durationTotals = durationTotalsFromRows(state.summary.durationTotals || {}, state.rows);
      }
      const recomputedBundle = recomputedReceiptBundleForEdit(index, row);
      if (recomputedBundle) {
        state.recomputedReceipt = {
          bundle: recomputedBundle,
          compactText: JSON.stringify(recomputedBundle, null, 2),
        };
      }
      renderReceiptStage();
      $("refreshStatus").textContent = "Updated latency assumptions";
    }

    function durationTotalsFromRows(existing, rows) {
      const durationRows = rows.filter((row) => row.primaryValueKind === "time_loss");
      return {
        ...existing,
        timeLossMs: durationRows.reduce((total, row) => total + Number(row.timeLossMs || 0), 0),
        providerRecognizedTimeLossMs: durationRows.reduce((total, row) => total + Number(row.providerRecognizedTimeLossMs || 0), 0),
        recognitionGapTimeMs: durationRows.reduce((total, row) => total + Number(row.recognitionGapTimeMs || 0), 0),
        dollarTranslationUsd: durationRows.reduce((total, row) => total + Number(row.dollarTranslationUsd || 0), 0),
      };
    }

    function actionCopyForRow(row) {
      const text = String((row.code || "") + " " + (row.failureClass || "")).toLowerCase();
      if (text.includes("broken") || text.includes("schema") || text.includes("json") || text.includes("tool")) {
        return { title: "Charged for an answer your app could not use", next: "Ask the provider for credit on these request IDs or add a retry/fallback rule." };
      }
      if (text.includes("trunc") || text.includes("empty")) {
        return { title: "Charged for an incomplete answer", next: "Ask whether these calls qualify for credit and check max-token settings." };
      }
      if (text.includes("token") || text.includes("recount")) {
        return { title: "Token count does not match the local check", next: "Compare this request to provider usage details before invoice review." };
      }
      if (text.includes("duplicate")) {
        return { title: "Same request may have been charged more than once", next: "Send the receipt with duplicate request IDs to provider support." };
      }
      if (text.includes("cache")) {
        return { title: "Cache discount may not have applied", next: "Compare these calls against your invoice and cache configuration." };
      }
      if (text.includes("downtime") || text.includes("timeout") || text.includes("availability")) {
        return { title: "Provider unavailable", next: "Use this receipt for service-credit discussion and consider fallback routing." };
      }
      if (text.includes("latency") || text.includes("slow")) {
        return { title: "Slow responses crossed your threshold", next: "Edit or confirm the threshold, then decide whether to adjust routing." };
      }
      if (text.includes("refusal") || text.includes("filter")) {
        return { title: "Provider refused or filtered a billed request", next: "Review policy fit and ask for credit if the request should have completed." };
      }
      if (text.includes("drift") || text.includes("regression")) {
        return { title: "Answer changed from the known baseline", next: "Review provider/model choice before routing more traffic." };
      }
      if (text.includes("security") || text.includes("governance")) {
        return { title: "Safety or governance signal appeared", next: "Review the prompt, output, and routing policy before reuse." };
      }
      if (text.includes("factual") || text.includes("citation")) {
        return { title: "Claim or citation support failed", next: "Do not rely on this answer without human or retrieval review." };
      }
      return { title: "Charged for an answer your app could not use", next: "Ask the provider for credit on these request IDs or add a retry/fallback rule." };
    }

    function openDetails(kind, row) {
      $("detailsTabs").innerHTML = "";
      if (kind === "proof") {
        $("detailsTitle").textContent = "View proof";
        $("detailsSubtitle").textContent = "Evidence strength, method IDs, traces, and exact computation.";
        $("detailsBody").innerHTML = proofHtml(row);
      } else if (kind === "privacy") {
        $("detailsTitle").textContent = "What leaves my machine";
        $("detailsSubtitle").textContent = "Provider calls go to your selected provider with its provider key. Provider keys are not sent to Inferock; attached only to provider requests.";
        $("detailsBody").innerHTML = privacyHtml();
      } else {
        focusReceiptDetails("signals");
        return;
      }
      showDialog($("detailsDialog"));
    }

    function proofHtml(row) {
      const standardLoss = row.standardLossUsd || 0;
      const recognized = row.providerRecognizedUsd || 0;
      const gap = row.recognitionGapUsd || row.unrecognizedUsd || 0;
      const timePrimary = row.primaryValueKind === "time_loss";
      return '<section class="info-block" data-testid="proof-panel">' +
        '<h3>Problem found</h3>' +
        '<p>' + escapeHtml(actionCopyForRow(row).title) + '</p>' +
        '<div class="modal-row"><span>Evidence strength</span><strong data-testid="proof-evidence-strength">' + escapeHtml(row.evidenceGrade || "unknown") + '</strong></div>' +
        (timePrimary
          ? '<div class="modal-row"><span>Measured time lost</span><strong>' + formatApproxTimeLost(row.timeLossMs || 0) + '</strong></div>' +
            '<div class="modal-row"><span>Provider-recognized</span><strong>' + formatUsd(recognized) + ' / ' + formatApproxTimeLost(row.providerRecognizedTimeLossMs || 0) + '</strong></div>' +
            '<div class="modal-row"><span>Time recognition gap</span><strong>' + formatApproxTimeLost(row.recognitionGapTimeMs || 0) + '</strong></div>' +
            '<div class="modal-row"><span>Secondary translation</span><strong>approx ' + formatUsd(row.dollarTranslationUsd || 0) + ' at your rate (edit)</strong></div>' +
            (row.thresholdSnapshot ? '<div class="modal-row"><span>Latency threshold proposal</span><strong>edit or confirm</strong></div>' : '') +
            (row.providerRecognitionLine ? '<p class="small muted">' + escapeHtml(row.providerRecognitionLine) + '</p>' : '')
          : '<div class="modal-row"><span>Loss measured by the standard</span><strong>' + formatUsd(standardLoss) + '</strong></div>' +
            '<div class="modal-row"><span>Provider-recognized</span><strong>' + formatUsd(recognized) + '</strong></div>' +
            '<div class="modal-row"><span>Recognition-gap</span><strong>' + formatUsd(gap) + '</strong></div>') +
        '<div class="info-block"><h3>How this was calculated</h3>' + linesFor(row.howComputed).map((line) => '<p class="small muted">' + escapeHtml(line) + '</p>').join("") + '</div>' +
        '<div class="info-block"><h3>Method IDs and traces</h3><p class="small muted">Problem code: ' + escapeHtml(row.code || "") + '</p><p class="small muted">Signal class: ' + escapeHtml(row.failureClass || "") + '</p><p class="small muted">Coverage method: ' + escapeHtml((state.summary && state.summary.coverage && state.summary.coverage.methodVersion) || "") + '</p></div>' +
        '<div class="info-block"><h3>Raw proof</h3><pre data-testid="proof-raw">' + escapeHtml(JSON.stringify(row, null, 2)) + '</pre></div>' +
      '</section>';
    }

    function privacyHtml() {
      return '<section class="info-block"><h3>What leaves my machine</h3><p class="small">The test sends prompts to the provider you choose. Provider keys are not sent to Inferock; attached only to provider requests. The local bench key is for apps talking to this localhost bench.</p><p class="small muted">BYOK note: provider billing happens in your provider account. Raw receipts are not sent to Inferock by this page.</p></section>';
    }

    function renderReceiptDetails() {
      const summary = state.summary || {};
      const coverage = summary.coverage || { surfaces: [], watchedCount: 0, totalSurfaceCount: 0, notOpenableCount: 0 };
      $("detailPanelSignals").innerHTML = signalsDetailsHtml(state.rows || []);
      $("detailPanelCoverage").innerHTML = coverageDetailsHtml(coverage);
      $("detailPanelCalls").innerHTML = callsDetailsHtml(state.calls || []);
      $("detailPanelRaw").innerHTML = rawReceiptDetailsHtml();
      $("detailPanelConnection").innerHTML = connectionDetailsHtml();
      $("detailPanelFingerprint").innerHTML = fingerprintDetailsHtml(coverage);
    }

    function signalsDetailsHtml(rows) {
      if (!rows.length) return emptyDetailHtml("No signals found in this run.");
      return tableHtml(
        [
          "Problem found",
          "Code / class",
          "Evidence strength",
          "Count",
          "Primary impact",
          "Recognized",
          "Gap",
        ],
        rows.map((row) => [
          actionCopyForRow(row).title,
          [row.code || "", row.failureClass || ""].filter(Boolean).join(" / "),
          row.evidenceGrade || "",
          integer.format(row.count || 0),
          row.primaryValueKind === "time_loss"
            ? formatApproxTimeLost(row.timeLossMs || 0)
            : formatUsd(row.standardLossUsd || 0),
          row.primaryValueKind === "time_loss"
            ? formatUsd(row.providerRecognizedUsd || 0) + " / " + formatApproxTimeLost(row.providerRecognizedTimeLossMs || 0)
            : formatUsd(row.providerRecognizedUsd || 0),
          row.primaryValueKind === "time_loss"
            ? formatApproxTimeLost(row.recognitionGapTimeMs || 0)
            : formatUsd(row.recognitionGapUsd || row.unrecognizedUsd || 0),
        ]),
        { numberColumns: [3, 4, 5, 6], testId: "signals-table" }
      ) + '<section class="info-block"><h3>Method IDs and traces</h3><pre class="raw-block" data-testid="signals-method-traces">' +
        escapeHtml(JSON.stringify(rows.map((row) => ({
          code: row.code || "",
          signalClass: row.failureClass || "",
          evidenceStrength: row.evidenceGrade || "",
          howComputed: linesFor(row.howComputed),
        })), null, 2)) +
      '</pre></section>';
    }

    function coverageDetailsHtml(coverage) {
      const surfaces = coverage.surfaces || [];
      if (!surfaces.length) return emptyDetailHtml("No coverage rows yet.");
      return '<div class="modal-row"><span>Surfaces watched</span><strong>' + integer.format(coverage.watchedCount || 0) + ' / ' + integer.format(coverage.totalSurfaceCount || 0) + '</strong></div>' +
        '<div class="modal-row"><span>Could not watch this check</span><strong>' + integer.format(coverage.notOpenableCount || 0) + '</strong></div>' +
        tableHtml(
          ["Surface", "Status", "Count", "Evidence strength", "Label"],
          surfaces.map((surface) => [
            surface.measure || "",
            plainCoverageStatus(surface.status) + " (" + String(surface.status || "") + ")",
            integer.format(surface.signalCount || 0),
            surface.evidenceGrade || "",
            surface.label || surface.notOpenableReason || "",
          ]),
          { numberColumns: [2], testId: "coverage-table" }
        ) + '<section class="info-block"><h3>Coverage row details</h3><pre class="raw-block" data-testid="coverage-row-details">' +
          escapeHtml(JSON.stringify(surfaces.map((surface) => ({
            surfaceId: surface.surfaceId || "",
            measure: surface.measure || "",
            status: surface.status || "",
            signalCount: surface.signalCount || 0,
            evidenceStrength: surface.evidenceGrade || "",
            label: surface.label || "",
            taskIds: surface.taskIds || [],
            detectorCodes: surface.detectorCodes || [],
            normalUsageRationale: surface.normalUsageRationale || "",
            notOpenableReason: surface.notOpenableReason || "",
            details: surface.details || {},
            watchedEvidence: surface.watchedEvidence || {},
          })), null, 2)) +
        '</pre></section>';
    }

    function callsDetailsHtml(calls) {
      if (!calls.length) return emptyDetailHtml("No provider calls recorded yet.");
      return tableHtml(
        ["Time", "Provider / model", "Status", "Tokens", "Cost"],
        calls.map((call) => [
          displayTime(call.time),
          providerLabel(call.provider) + " / " + (call.model || ""),
          String(call.status || "") + " " + String(call.statusCode || ""),
          integer.format(call.totalTokens || 0) + " total (" + integer.format(call.inputTokens || 0) + " in, " + integer.format(call.outputTokens || 0) + " out)",
          formatUsd(call.costUsd || 0),
        ]),
        { numberColumns: [4], testId: "calls-table" }
      );
    }

    function rawReceiptDetailsHtml() {
      const receiptJson = state.receipt && state.receipt.bundle
        ? JSON.stringify(state.receipt.bundle, null, 2)
        : "{}";
      return '<pre class="raw-block" data-testid="raw-receipt">' + escapeHtml(receiptJson) + '</pre>';
    }

    function connectionDetailsHtml() {
      const setup = state.setup;
      const configured = setup
        ? PROVIDER_NAMES.filter((provider) => setup.providers[provider] && setup.providers[provider].configured)
        : [];
      return '<div class="connection-grid">' +
        '<div><p class="code-label">Local bench key</p><pre class="raw-block" data-testid="details-local-bench-key">' + escapeHtml((setup && setup.maskedBenchKey) || "No local key yet") + '</pre></div>' +
        (configured.length
          ? configured.map((provider) => '<div><p class="code-label">' + escapeHtml(providerLabel(provider)) + ' SDK snippet</p><pre class="raw-block">' + escapeHtml(snippetFor(provider)) + '</pre></div>').join("")
          : '<p class="small">Paste a provider key to show SDK snippets for routed calls.</p>') +
      '</div>';
    }

    function fingerprintDetailsHtml(coverage) {
      const bundle = receiptBundle();
      if (bundle && bundle.schemaVersion === "inferock-bench-receipt-v1") {
        const period = bundle.period || {};
        return '<div class="fingerprint-grid">' +
          '<div class="modal-row"><span>Result type</span><strong>Previous results</strong></div>' +
          '<div class="modal-row"><span>Period</span><strong>' + escapeHtml(periodLabel(period)) + '</strong></div>' +
          '<div class="modal-row"><span>Generated</span><strong>' + escapeHtml(displayTime(bundle.generatedAt)) + '</strong></div>' +
          '<div class="modal-row"><span>Coverage method</span><strong>' + escapeHtml((bundle.coverage && bundle.coverage.methodVersion) || (coverage && coverage.methodVersion) || "") + '</strong></div>' +
          '<div class="modal-row"><span>Receipt schema</span><strong>' + escapeHtml(bundle.schemaVersion) + '</strong></div>' +
        '</div>';
      }
      const run = bundle && bundle.run ? bundle.run : {};
      const estimate = bundle && bundle.consent && bundle.consent.estimate ? bundle.consent.estimate : {};
      const consentHash = estimate.estimateHash ||
        (state.coverageRun && state.coverageRun.consentHash) ||
        (state.coverageEstimate && state.coverageEstimate.consentHash) ||
        "";
      const receiptSchema = bundle ? bundle.schemaVersion : "";
      const resultType = state.receiptMode === "history"
        ? '<div class="modal-row"><span>Result type</span><strong>Previous results</strong></div>'
        : state.receiptMode === "previous-run"
          ? '<div class="modal-row"><span>Result type</span><strong>Previous run receipt</strong></div>'
          : "";
      return '<div class="fingerprint-grid">' +
        resultType +
        '<div class="modal-row"><span>Run ID</span><strong>' + escapeHtml(run.runId || coverage.runId || "") + '</strong></div>' +
        '<div class="modal-row"><span>Run fingerprint</span><strong>' + escapeHtml(consentHash) + '</strong></div>' +
        '<div class="modal-row"><span>Test version</span><strong>' + escapeHtml(run.suiteVersion || coverage.suiteVersion || "") + '</strong></div>' +
        '<div class="modal-row"><span>Coverage method</span><strong>' + escapeHtml(coverage.methodVersion || "") + '</strong></div>' +
        '<div class="modal-row"><span>Receipt schema</span><strong>' + escapeHtml(receiptSchema) + '</strong></div>' +
      '</div>';
    }

    function tableHtml(headers, rows, options) {
      const numberColumns = new Set(options && options.numberColumns ? options.numberColumns : []);
      const tableId = (options && options.testId) || "details-table";
      const tableLabel = tableId.split("-").join(" ") + " scroll area";
      return '<div class="table-wrap" tabindex="0" role="region" aria-label="' + escapeHtml(tableLabel) + '"><table data-testid="' + escapeHtml(tableId) + '"><thead><tr>' +
        headers.map((header, index) => '<th' + (numberColumns.has(index) ? ' class="table-number"' : '') + '>' + escapeHtml(header) + '</th>').join("") +
        '</tr></thead><tbody>' +
        rows.map((row) => '<tr>' + row.map((cell, index) => '<td' + (numberColumns.has(index) ? ' class="table-number"' : '') + '>' + escapeHtml(displayCell(cell)) + '</td>').join("") + '</tr>').join("") +
        '</tbody></table></div>';
    }

    function emptyDetailHtml(message) {
      return '<p class="small">' + escapeHtml(message) + '</p>';
    }

    function linesFor(value) {
      if (Array.isArray(value)) return value.map((line) => String(line));
      if (typeof value === "string") return value.split("\\n").map((line) => line.trim()).filter(Boolean);
      return [];
    }

    function displayCell(value) {
      return value === undefined || value === null ? "" : String(value);
    }

    function displayTime(value) {
      if (!value) return "";
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString();
    }

    function periodLabel(period) {
      const since = period && period.since ? new Date(period.since).toLocaleString() : "beginning";
      const until = period && period.until ? new Date(period.until).toLocaleString() : "now";
      return since + " to " + until;
    }

    function surfaceDetailsText(surface) {
      const parts = [];
      if (surface.normalUsageRationale) parts.push(surface.normalUsageRationale);
      if (surface.notOpenableReason) parts.push(surface.notOpenableReason);
      if (surface.details) parts.push(JSON.stringify(surface.details));
      if (surface.watchedEvidence) parts.push(JSON.stringify(surface.watchedEvidence));
      return parts.join(" ");
    }

    function activateReceiptDetailsTab(tab) {
      for (const button of document.querySelectorAll("[data-detail-tab]")) {
        const selected = button.getAttribute("data-detail-tab") === tab;
        button.setAttribute("aria-selected", selected ? "true" : "false");
      }
      for (const panel of document.querySelectorAll("[data-detail-panel]")) {
        if (panel.getAttribute("data-detail-panel") === tab) panel.removeAttribute("hidden");
        else panel.setAttribute("hidden", "");
      }
    }

    function focusReceiptDetails(tab) {
      activateReceiptDetailsTab(tab);
      $("receiptDetails").scrollIntoView({ block: "start" });
      const button = document.querySelector('[data-detail-tab="' + tab + '"]');
      if (button) button.focus();
    }

    function surfaceHtml(surface) {
      return '<div class="surface-item"><strong>' + escapeHtml(surface.measure || "") + '</strong><span class="small muted">' + escapeHtml(plainCoverageStatus(surface.status)) + ' · ' + integer.format(surface.signalCount || 0) + ' signal' + ((surface.signalCount || 0) === 1 ? '' : 's') + '</span><span class="small muted">' + escapeHtml(surface.label || surface.notOpenableReason || "") + '</span></div>';
    }

    function plainCoverageStatus(status) {
      if (status === "not_openable") return "Could not watch this check";
      if (status === "watched_clean") return "Watched, no problem found";
      if (status === "signal") return "Problem found";
      return "Price not known yet";
    }

    function callHtml(call) {
      return '<div class="call-item"><strong>' + escapeHtml(providerLabel(call.provider)) + ' · ' + escapeHtml(call.model || "") + '</strong><span class="small muted">' + escapeHtml(displayTime(call.time)) + ' · ' + integer.format(call.totalTokens || 0) + ' tokens · ' + formatUsd(call.costUsd) + '</span></div>';
    }

    async function refresh() {
      try {
        const scope = receiptScopeParams();
        const responses = await Promise.all([
          fetch(apiPath("/api/summary", scope)),
          fetch(apiPath("/api/rows", scope)),
          fetch(apiPath("/api/calls", { ...scope, limit: "8" })),
          fetch(receiptApiPath(scope)),
          fetch("/api/coverage-test/options"),
          fetch("/api/coverage-test/runs"),
        ]);
        for (const response of responses) {
          if (!response.ok) throw new Error("HTTP " + response.status);
        }
        renderSummary(await responses[0].json());
        renderRows(await responses[1].json());
        renderCalls(await responses[2].json());
        renderReceipt(await responses[3].json());
        renderCoverageOptions(await responses[4].json());
        renderRuns(await responses[5].json());
        if (state.receiptMode === "previous-run") applyReceiptFallbackFromCurrentReceipt();
        await hydrateLatestCoverageRun();
        $("refreshStatus").textContent = "Updated " + new Date().toLocaleTimeString();
      } catch (error) {
        $("refreshStatus").textContent = "Refresh failed: " + (error && error.message ? error.message : "unknown error");
      }
    }

    function receiptScopeParams() {
      if (state.receiptMode === "history") return { scope: "all" };
      if ((state.receiptMode === "previous-run" || state.receiptMode === "current-run") && state.selectedReceiptRunId) {
        return { runId: state.selectedReceiptRunId };
      }
      return {};
    }

    function receiptApiPath(scope) {
      if ((state.receiptMode === "previous-run" || state.receiptMode === "current-run") && state.selectedReceiptRunId) {
        return "/api/coverage-test/runs/" + encodeURIComponent(state.selectedReceiptRunId) + "/receipt";
      }
      return apiPath("/api/receipt", scope);
    }

    function apiPath(path, params) {
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(params || {})) {
        if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
      }
      const query = search.toString();
      return query ? path + "?" + query : path;
    }

    async function hydrateLatestCoverageRun() {
      if (state.viewingPreviousResults) return;
      if (state.coverageRun && isCoverageRunActive()) return;
      const latest = state.coverageOptions && state.coverageOptions.latestRun;
      if (!latest || !latest.runId) return;
      const response = await fetch("/api/coverage-test/runs/" + encodeURIComponent(latest.runId), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const run = await response.json();
      if (!run || !run.runId) return;
      if (["queued", "running", "draining"].includes(run.status)) {
        renderCoverageRun(run);
        connectCoverageEvents(run.runId);
      } else if (run.receiptReady) {
        state.coverageRun = run;
        fetchCoverageReceipt(run.runId).catch((error) => {
          $("refreshStatus").textContent = error.message || "Receipt failed.";
        });
      }
    }

    function scheduleSaveKeys() {
      if (state.saveTimer) window.clearTimeout(state.saveTimer);
      state.saveTimer = window.setTimeout(() => {
        state.saveTimer = null;
        savePendingKeysNow().catch((error) => {
          $("refreshStatus").textContent = error.message || "Could not save provider key.";
        });
      }, 350);
    }

    async function savePendingKeysNow() {
      if (state.saveTimer) {
        window.clearTimeout(state.saveTimer);
        state.saveTimer = null;
      }
      const body = {};
      const openaiKey = $("openaiKeyInput").value.trim();
      const anthropicKey = $("anthropicKeyInput").value.trim();
      const geminiKey = $("geminiKeyInput").value.trim();
      const openrouterKey = $("openrouterKeyInput").value.trim();
      if (openaiKey) body.openaiApiKey = openaiKey;
      if (anthropicKey) body.anthropicApiKey = anthropicKey;
      if (geminiKey) body.geminiApiKey = geminiKey;
      if (openrouterKey) body.openrouterApiKey = openrouterKey;
      if (Object.keys(body).length === 0) return;
      const response = await managementFetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      $("openaiKeyInput").value = "";
      $("anthropicKeyInput").value = "";
      $("geminiKeyInput").value = "";
      $("openrouterKeyInput").value = "";
      renderSummary(await response.json());
      await refresh();
    }

    async function removeProvider(provider) {
      const response = await managementFetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(removeProviderPayload(provider)),
      });
      if (!response.ok) throw new Error(await errorMessageFromResponse(response));
      renderSummary(await response.json());
      await refresh();
    }

    function removeProviderPayload(provider) {
      if (provider === "openai") return { openaiApiKey: null };
      if (provider === "anthropic") return { anthropicApiKey: null };
      if (provider === "gemini") return { geminiApiKey: null };
      if (provider === "openrouter") return { openrouterApiKey: null };
      throw new Error("Unknown provider " + String(provider || "missing"));
    }

    async function copyText(text) {
      await navigator.clipboard.writeText(text);
    }

    async function revealAndCopyBenchKey() {
      const response = await managementFetch("/api/key", { cache: "no-store" });
      if (!response.ok) throw new Error("Key reveal failed.");
      const payload = await response.json();
      if (!payload.benchKey) throw new Error("Key reveal missing.");
      await copyText(payload.benchKey);
      $("benchKeyValue").textContent = payload.benchKey;
      $("copyKeyButton").textContent = "Copied";
      window.setTimeout(() => {
        $("benchKeyValue").textContent = state.setup && state.setup.maskedBenchKey ? state.setup.maskedBenchKey : "";
        $("copyKeyButton").textContent = "Reveal/copy";
      }, 10000);
    }

    function downloadReceipt() {
      const bundle = activeExportReceiptBundle();
      if (!bundle) return;
      const blob = new Blob([JSON.stringify(bundle, null, 2) + "\\n"], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = receiptDownloadFilename(bundle);
      link.click();
      URL.revokeObjectURL(link.href);
    }

    async function errorMessageFromResponse(response) {
      try {
        const payload = await response.json();
        return payload.message || (payload.error && payload.error.message) || payload.error || "HTTP " + response.status;
      } catch {
        return "HTTP " + response.status;
      }
    }

    function showDialog(dialog) {
      if (dialog.showModal) dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    function closeDialog(dialog) {
      if (dialog.close) dialog.close();
      else dialog.removeAttribute("open");
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function displaySecretLabel(value) {
      const text = String(value || "");
      const sensitivePrefixes = [["s", "k", "-"].join(""), ["i", "b", "l", "_"].join("")];
      if (sensitivePrefixes.some((prefix) => text.startsWith(prefix))) return text.slice(0, 3) + "..." + text.slice(-4);
      return text;
    }

    for (const input of [$("openaiKeyInput"), $("anthropicKeyInput"), $("geminiKeyInput"), $("openrouterKeyInput")]) {
      input.addEventListener("input", scheduleSaveKeys);
    }
    for (const button of document.querySelectorAll("[data-provider-scope]")) {
      button.addEventListener("click", () => {
        state.providerScope = button.getAttribute("data-provider-scope") || "all";
        renderProviderScope();
        renderModelPickers();
        renderAdvancedOptions();
        invalidateCoverageEstimate();
      });
    }
    $("runTestButton").addEventListener("click", () => openCoverageConsent().catch((error) => {
      $("refreshStatus").textContent = error.message || "Could not open price sheet.";
    }));
    $("runAgainButton").addEventListener("click", () => openCoverageConsent().catch((error) => {
      $("refreshStatus").textContent = error.message || "Could not open price sheet.";
    }));
    $("openSettingsButton").addEventListener("click", () => showDialog($("settingsDialog")));
    $("closeSettingsButton").addEventListener("click", () => closeDialog($("settingsDialog")));
    $("privacyDetailsButton").addEventListener("click", () => openDetails("privacy"));
    $("advancedDetailsButton").addEventListener("click", () => showDialog($("settingsDialog")));
    $("connectionDetailsButton").addEventListener("click", () => showDialog($("settingsDialog")));
    $("viewPreviousResultsButton").addEventListener("click", () => openPreviousResults().catch((error) => {
      $("refreshStatus").textContent = error.message || "Could not open previous results.";
    }));
    $("closeDetailsButton").addEventListener("click", () => closeDialog($("detailsDialog")));
    $("copyReceiptButton").addEventListener("click", () => state.receipt && copyText(activeExportReceiptText()));
    $("downloadReceiptButton").addEventListener("click", downloadReceipt);
    for (const button of document.querySelectorAll("[data-detail-tab]")) {
      button.addEventListener("click", () => activateReceiptDetailsTab(button.getAttribute("data-detail-tab") || "signals"));
    }
    $("copyKeyButton").addEventListener("click", () => state.setup && revealAndCopyBenchKey().catch((error) => {
      $("refreshStatus").textContent = error.message || "Key reveal failed.";
    }));
    for (const button of document.querySelectorAll("[data-remove-provider]")) {
      button.addEventListener("click", () => removeProvider(button.getAttribute("data-remove-provider")).catch((error) => {
        $("refreshStatus").textContent = error.message || "Could not remove provider.";
      }));
    }
    $("coverageGeneratorSelect").addEventListener("change", invalidateCoverageEstimate);
    $("coverageSpendCapInput").addEventListener("change", invalidateCoverageEstimate);
    $("showPricingDetailsButton").addEventListener("click", () => $("pricingDetailsPanel").classList.toggle("visible"));
    $("showFingerprintButton").addEventListener("click", () => $("fingerprintPanel").classList.toggle("visible"));
    $("agentInstallAck").addEventListener("change", () => {
      const payload = state.coverageEstimate;
      const sectionHash = $("agentInstallConsent").getAttribute("data-consent-hash");
      state.agentInstallAcknowledgedHash = $("agentInstallAck").checked &&
        payload &&
        payload.agentInstall &&
        sectionHash === payload.agentInstall.consentHash
        ? payload.agentInstall.consentHash
        : null;
      updateCoverageConsentStartEnabled();
    });
    $("consentStartButton").addEventListener("click", () => startCoverageRun().catch((error) => {
      $("refreshStatus").textContent = error.message || "Could not start test.";
    }));
    $("consentCancelButton").addEventListener("click", closeCoverageConsent);
    $("toggleLiveDetailsButton").addEventListener("click", () => {
      const live = $("liveDetails");
      live.classList.toggle("visible");
      $("toggleLiveDetailsButton").textContent = live.classList.contains("visible") ? "Hide live details" : "Show live details";
    });
    $("abortRunButton").addEventListener("click", () => abortCoverageRun().catch((error) => {
      $("refreshStatus").textContent = error.message || "Abort failed.";
    }));

    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}

function providerState(
  provider: ProviderName,
  config: BenchConfig,
  env: NodeJS.ProcessEnv,
): DashboardProviderState {
  return {
    ...providerKeyStatus(provider, config, env),
    providerApiBaseUrl: providerBaseUrl(provider, config, env),
  };
}

function configuredBenchKey(
  config: BenchConfig,
  env: NodeJS.ProcessEnv,
): string {
  return config.benchKey ?? benchKeyFromConfig(config, env);
}

function totalTokens(event: ReturnType<typeof normalizeCanonicalEvent>): number {
  return event.usage.input +
    event.usage.output +
    (event.usage.cache?.read ?? 0) +
    (event.usage.cache?.creation ?? 0);
}
