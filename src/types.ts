/**
 * Spectrum Analytics Dashboard - TypeScript Type Definitions
 */

/**
 * Cloudflare API error structure
 */
export interface CloudflareAPIError {
	success: false;
	errors: Array<{
		code: number;
		message: string;
	}>;
	messages: string[];
}

/**
 * Cloudflare API success response wrapper
 */
export interface CloudflareAPIResponse<T> {
	success: true;
	errors: never[];
	messages: string[];
	result: T;
}

/**
 * Spectrum Analytics Event dimensions
 */
export interface SpectrumEventDimensions {
	event?: string;
	appID?: string;
	coloName?: string;
	ipVersion?: string;
	ts?: string;
	datetime?: string;
}

/**
 * Spectrum Analytics Event metrics
 */
export interface SpectrumEventMetrics {
	count?: number;
	bytesIngress?: number;
	bytesEgress?: number;
	durationAvg?: number;
	durationMedian?: number;
	duration90th?: number;
	duration99th?: number;
}

/**
 * Spectrum Analytics Event data row
 */
export interface SpectrumEventData extends SpectrumEventMetrics {
	dimensions?: SpectrumEventDimensions;
}

/**
 * Spectrum Analytics Events Summary/ByTime Response
 */
export interface SpectrumAnalyticsResult {
	data: SpectrumEventData[];
	data_lag?: number;
	min?: Record<string, unknown>;
	max?: Record<string, unknown>;
	totals?: Record<string, number>;
	query?: {
		since?: string;
		until?: string;
		time_delta?: string;
		dimensions?: string[];
		metrics?: string[];
		filters?: string;
		sort?: string[];
		limit?: number;
	};
}

/**
 * Spectrum Analytics Response type
 */
export type SpectrumAnalyticsResponse = CloudflareAPIResponse<SpectrumAnalyticsResult>;

/**
 * Spectrum Current Connection data
 */
export interface SpectrumCurrentConnection {
	appID: string;
	connections: number;
	bytesIngress: number;
	bytesEgress: number;
	durationAvg: number;
}

/**
 * Spectrum Current Connections Response type
 */
export type SpectrumCurrentResponse = CloudflareAPIResponse<SpectrumCurrentConnection[]>;

/**
 * Request headers interface
 */
export interface RequestHeaders {
	'X-CF-API-Token'?: string | null;
	'X-CF-Zone-ID'?: string | null;
}

/**
 * Verify request body
 */
export interface VerifyRequestBody {
	apiToken: string;
	zoneId: string;
}

/**
 * Verify response
 */
export interface VerifyResponse {
	success: boolean;
	message?: string;
	error?: string;
}

/**
 * API Error response
 */
export interface APIErrorResponse {
	success: false;
	error: string;
}

/**
 * Time range configuration
 */
export interface TimeRangeConfig {
	hours?: number;
	days?: number;
	step: 'minute' | 'hour' | 'day';
}

/**
 * Dashboard state
 */
export interface DashboardState {
	apiToken: string | null;
	zoneId: string | null;
	timeRange: string;
	appFilter: string;
	charts: {
		connections: unknown | null;
		bandwidth: unknown | null;
		events: unknown | null;
		colo: unknown | null;
	};
	refreshInterval: number | null;
}
