/**
 * Spectrum Analytics Dashboard - Cloudflare Worker
 *
 * This Worker serves as an API proxy between the frontend and Cloudflare's
 * Spectrum Analytics API. It validates requests, forwards them to the
 * Cloudflare API with the user's token, and returns the results.
 *
 * Security considerations:
 * - API tokens are passed via headers, never stored server-side
 * - All requests to Cloudflare API use HTTPS
 * - Strict input validation on all user-provided data
 * - API tokens are validated for format before use
 * - Rate limiting headers are preserved from upstream API
 * - No sensitive data is logged
 *
 * @see https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
 */

import type { SpectrumAnalyticsResponse, SpectrumCurrentResponse, CloudflareAPIError, RequestHeaders } from './types';

// Cloudflare API base URL
const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

// Security: Maximum request body size (1KB should be plenty for our use case)
const MAX_REQUEST_BODY_SIZE = 1024;

// Security: API Token format validation (Cloudflare tokens are typically 40 chars)
const API_TOKEN_PATTERN = /^[a-zA-Z0-9_-]{20,100}$/;

/**
 * Main Worker fetch handler
 */
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Only handle API routes - static assets are served by the asset binding
		if (!url.pathname.startsWith('/api/')) {
			return new Response('Not Found', { status: 404 });
		}

		// Handle CORS preflight
		if (request.method === 'OPTIONS') {
			return handleCORS(request);
		}

		// Route API requests
		try {
			const response = await handleAPIRequest(request, url);
			return addCORSHeaders(response, request);
		} catch (error) {
			console.error('API Error:', error);
			return addCORSHeaders(
				createErrorResponse(error instanceof Error ? error.message : 'Internal server error', 500),
				request
			);
		}
	},
} satisfies ExportedHandler<Env>;

/**
 * Route API requests to appropriate handlers
 */
async function handleAPIRequest(request: Request, url: URL): Promise<Response> {
	const path = url.pathname;

	// Health check endpoint - for monitoring
	if (path === '/api/health') {
		return createJSONResponse({
			status: 'healthy',
			timestamp: new Date().toISOString(),
			version: '1.0.0',
		});
	}

	// Verify endpoint - tests if credentials are valid
	if (path === '/api/spectrum/verify') {
		return handleVerify(request);
	}

	// All other endpoints require credentials in headers
	const apiToken = request.headers.get('X-CF-API-Token');
	const zoneId = request.headers.get('X-CF-Zone-ID');

	if (!apiToken || !zoneId) {
		return createErrorResponse('Missing API token or Zone ID', 401);
	}

	// Security: Validate API token format
	if (!API_TOKEN_PATTERN.test(apiToken)) {
		return createErrorResponse('Invalid API token format', 400);
	}

	// Validate Zone ID format (32 hex characters)
	if (!/^[a-f0-9]{32}$/i.test(zoneId)) {
		return createErrorResponse('Invalid Zone ID format', 400);
	}

	// Route to specific handlers
	if (path === '/api/spectrum/events/summary') {
		return handleEventsSummary(request, apiToken, zoneId, url.searchParams);
	}

	if (path === '/api/spectrum/events/bytime') {
		return handleEventsByTime(request, apiToken, zoneId, url.searchParams);
	}

	if (path === '/api/spectrum/aggregate/current') {
		return handleAggregateCurrent(request, apiToken, zoneId);
	}

	// Optional: Spectrum apps endpoint (requires Spectrum Read permission)
	// Returns 403 if user only has Analytics Read - frontend handles gracefully
	if (path === '/api/spectrum/apps') {
		return handleSpectrumApps(request, apiToken, zoneId);
	}

	return createErrorResponse('Not Found', 404);
}

/**
 * Handle credential verification
 * Security: Validates input format before making external requests
 */
async function handleVerify(request: Request): Promise<Response> {
	if (request.method !== 'POST') {
		return createErrorResponse('Method not allowed', 405);
	}

	// Security: Check content length to prevent oversized payloads
	const contentLength = request.headers.get('Content-Length');
	if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_BODY_SIZE) {
		return createErrorResponse('Request body too large', 413);
	}

	let body: { apiToken?: string; zoneId?: string };
	try {
		body = await request.json();
	} catch {
		return createErrorResponse('Invalid JSON body', 400);
	}

	const { apiToken, zoneId } = body;

	if (!apiToken || !zoneId) {
		return createErrorResponse('Missing API token or Zone ID', 400);
	}

	// Security: Validate API token format
	if (!API_TOKEN_PATTERN.test(apiToken)) {
		return createErrorResponse('Invalid API token format', 400);
	}

	// Validate Zone ID format
	if (!/^[a-f0-9]{32}$/i.test(zoneId)) {
		return createErrorResponse('Invalid Zone ID format', 400);
	}

	// Test the credentials by making a simple analytics API call
	// Using analytics/events/summary which requires Analytics Read permission
	try {
		const testUrl = `${CF_API_BASE}/zones/${zoneId}/spectrum/analytics/events/summary?metrics=count`;
		const response = await fetch(testUrl, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
			},
		});

		if (!response.ok) {
			const errorData = (await response.json()) as CloudflareAPIError;
			const errorMessage = errorData.errors?.[0]?.message || 'Invalid credentials or insufficient permissions';
			return createErrorResponse(errorMessage, response.status);
		}

		const data = (await response.json()) as { result?: { totals?: { count?: number } } };
		return createJSONResponse({
			success: true,
			message: 'Credentials verified - Analytics Read permission confirmed',
			hasData: (data?.result?.totals?.count ?? 0) > 0,
		});
	} catch (error) {
		console.error('Verify error:', error);
		return createErrorResponse('Failed to verify credentials', 500);
	}
}

/**
 * Handle Spectrum Analytics Events Summary endpoint
 * GET /zones/{zone_id}/spectrum/analytics/events/summary
 */
async function handleEventsSummary(
	request: Request,
	apiToken: string,
	zoneId: string,
	params: URLSearchParams
): Promise<Response> {
	if (request.method !== 'GET') {
		return createErrorResponse('Method not allowed', 405);
	}

	// Build the Cloudflare API URL with query parameters
	const cfParams = new URLSearchParams();

	// Required parameters
	const since = params.get('since');
	const until = params.get('until');

	if (since) cfParams.set('since', since);
	if (until) cfParams.set('until', until);

	// Optional parameters
	const metrics = params.get('metrics');
	if (metrics) cfParams.set('metrics', metrics);

	const dimensions = params.get('dimensions');
	if (dimensions) cfParams.set('dimensions', dimensions);

	const filters = params.get('filters');
	if (filters) cfParams.set('filters', filters);

	const sort = params.get('sort');
	if (sort) cfParams.set('sort', sort);

	const limit = params.get('limit');
	if (limit) cfParams.set('limit', limit);

	const cfUrl = `${CF_API_BASE}/zones/${zoneId}/spectrum/analytics/events/summary?${cfParams}`;

	return proxyToCloudflareAPI(cfUrl, apiToken);
}

/**
 * Handle Spectrum Analytics Events By Time endpoint
 * GET /zones/{zone_id}/spectrum/analytics/events/bytime
 */
async function handleEventsByTime(
	request: Request,
	apiToken: string,
	zoneId: string,
	params: URLSearchParams
): Promise<Response> {
	if (request.method !== 'GET') {
		return createErrorResponse('Method not allowed', 405);
	}

	// Build the Cloudflare API URL with query parameters
	const cfParams = new URLSearchParams();

	// Required parameters
	const since = params.get('since');
	const until = params.get('until');

	if (since) cfParams.set('since', since);
	if (until) cfParams.set('until', until);

	// Optional parameters
	const metrics = params.get('metrics');
	if (metrics) cfParams.set('metrics', metrics);

	const dimensions = params.get('dimensions');
	if (dimensions) cfParams.set('dimensions', dimensions);

	const filters = params.get('filters');
	if (filters) cfParams.set('filters', filters);

	const timeDelta = params.get('time_delta');
	if (timeDelta) cfParams.set('time_delta', timeDelta);

	const sort = params.get('sort');
	if (sort) cfParams.set('sort', sort);

	const limit = params.get('limit');
	if (limit) cfParams.set('limit', limit);

	const cfUrl = `${CF_API_BASE}/zones/${zoneId}/spectrum/analytics/events/bytime?${cfParams}`;

	return proxyToCloudflareAPI(cfUrl, apiToken);
}

/**
 * Handle Spectrum Analytics Aggregate Current endpoint
 * GET /zones/{zone_id}/spectrum/analytics/aggregate/current
 * Supports optional appID and colo_name filters
 */
async function handleAggregateCurrent(request: Request, apiToken: string, zoneId: string): Promise<Response> {
	if (request.method !== 'GET') {
		return createErrorResponse('Method not allowed', 405);
	}

	const url = new URL(request.url);
	const cfParams = new URLSearchParams();

	// Optional filter by app ID(s)
	const appID = url.searchParams.get('appID');
	if (appID) cfParams.set('appID', appID);

	// Optional filter by colo name
	const coloName = url.searchParams.get('colo_name');
	if (coloName) cfParams.set('colo_name', coloName);

	const queryString = cfParams.toString();
	const cfUrl = `${CF_API_BASE}/zones/${zoneId}/spectrum/analytics/aggregate/current${queryString ? '?' + queryString : ''}`;

	return proxyToCloudflareAPI(cfUrl, apiToken);
}

/**
 * Handle Spectrum Apps endpoint (optional - requires Spectrum Read permission)
 * GET /zones/{zone_id}/spectrum/apps
 * Returns application metadata including hostnames/DNS names
 * 
 * NOTE: This endpoint requires 'Spectrum Read' permission, not just 'Analytics Read'.
 * If the user only has Analytics Read, this will return 403 and the frontend
 * will gracefully fall back to showing Application IDs without hostnames.
 */
async function handleSpectrumApps(request: Request, apiToken: string, zoneId: string): Promise<Response> {
	if (request.method !== 'GET') {
		return createErrorResponse('Method not allowed', 405);
	}

	const cfUrl = `${CF_API_BASE}/zones/${zoneId}/spectrum/apps`;
	return proxyToCloudflareAPI(cfUrl, apiToken);
}



// Request timeout for external API calls (25 seconds)
const API_TIMEOUT_MS = 25000;

/**
 * Proxy a request to the Cloudflare API with timeout
 */
async function proxyToCloudflareAPI(url: string, apiToken: string): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${apiToken}`,
				'Content-Type': 'application/json',
			},
			signal: controller.signal,
		});
		clearTimeout(timeoutId);

		const data = await response.json();

		// Preserve rate limiting headers from upstream
		const rateLimitHeaders: Record<string, string> = {};
		const headersToPreserve = ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'];
		headersToPreserve.forEach(header => {
			const value = response.headers.get(header);
			if (value) rateLimitHeaders[header] = value;
		});

		if (!response.ok) {
			const errorData = data as CloudflareAPIError;
			const errorMessage = errorData.errors?.[0]?.message || 'API request failed';
			return createErrorResponse(errorMessage, response.status, rateLimitHeaders);
		}

		return createJSONResponse(data, 200, rateLimitHeaders);
	} catch (error) {
		clearTimeout(timeoutId);
		if (error instanceof Error && error.name === 'AbortError') {
			return createErrorResponse('Request timeout - upstream API took too long', 504);
		}
		console.error('Proxy error:', error);
		return createErrorResponse('Failed to fetch from Cloudflare API', 502);
	}
}

/**
 * Create a JSON response with optional additional headers
 */
function createJSONResponse(data: unknown, status: number = 200, additionalHeaders?: Record<string, string>): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'X-Content-Type-Options': 'nosniff',
			'Cache-Control': 'no-store, no-cache, must-revalidate',
			...additionalHeaders,
		},
	});
}

/**
 * Create an error response with optional additional headers
 */
function createErrorResponse(message: string, status: number, additionalHeaders?: Record<string, string>): Response {
	return createJSONResponse({ success: false, error: message }, status, additionalHeaders);
}

/**
 * Handle CORS preflight requests
 */
function handleCORS(request: Request): Response {
	return new Response(null, {
		status: 204,
		headers: getCORSHeaders(request),
	});
}

/**
 * Add CORS headers to a response
 */
function addCORSHeaders(response: Response, request?: Request): Response {
	const newHeaders = new Headers(response.headers);
	const corsHeaders = getCORSHeaders(request);

	for (const [key, value] of Object.entries(corsHeaders)) {
		newHeaders.set(key, value);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: newHeaders,
	});
}

/**
 * Get CORS headers
 * Note: In production, consider restricting to specific origins
 * For this educational dashboard, we allow same-origin requests and localhost for development
 */
function getCORSHeaders(request?: Request): Record<string, string> {
	// For a deployed Worker, requests from the same domain don't need CORS
	// This primarily supports local development and cross-origin usage
	const origin = request?.headers.get('Origin');
	
	// Allow same-origin, localhost for dev, and the deployed Worker domain
	const allowedPatterns = [
		/^https?:\/\/localhost(:\d+)?$/,
		/^https?:\/\/127\.0\.0\.1(:\d+)?$/,
		/\.workers\.dev$/,
		/\.pages\.dev$/,
	];
	
	const allowOrigin = origin && allowedPatterns.some(pattern => pattern.test(origin))
		? origin
		: 'null'; // Deny unknown origins
	
	return {
		'Access-Control-Allow-Origin': allowOrigin,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type, X-CF-API-Token, X-CF-Zone-ID',
		'Access-Control-Max-Age': '86400',
		'Vary': 'Origin',
	};
}
