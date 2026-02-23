import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src';

describe('Spectrum Analytics Dashboard Worker', () => {
	describe('Static Assets', () => {
		it('serves index.html at root path (integration style)', async () => {
			const request = new Request('http://example.com/');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain('Spectrum Analytics Dashboard');
		});

		it('serves CSS files (integration style)', async () => {
			const request = new Request('http://example.com/styles.css');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain('--cf-orange');
		});

		it('serves JavaScript files (integration style)', async () => {
			const request = new Request('http://example.com/app.js');
			const response = await SELF.fetch(request);
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain('Spectrum Analytics Dashboard');
		});
	});

	describe('API - Verify Endpoint', () => {
		it('returns error for missing credentials (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/spectrum/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({}),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data).toHaveProperty('success', false);
			expect(data).toHaveProperty('error');
		});

		it('returns error for invalid Zone ID format (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/spectrum/verify', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					// Valid API token format (20+ alphanumeric chars)
					apiToken: 'test-token-valid-format-1234567890',
					zoneId: 'invalid-zone-id',
				}),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data).toHaveProperty('success', false);
			expect(data).toHaveProperty('error', 'Invalid Zone ID format');
		});

		it('rejects GET requests to verify endpoint (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/spectrum/verify', {
				method: 'GET',
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(405);
		});
	});

	describe('API - Analytics Endpoints', () => {
		it('returns 401 for missing API token on events/summary (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				'http://example.com/api/spectrum/events/summary?since=2024-01-01T00:00:00Z&until=2024-01-02T00:00:00Z',
				{
					method: 'GET',
				}
			);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(401);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Missing API token or Zone ID');
		});

		it('returns 400 for invalid Zone ID on events/summary (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				'http://example.com/api/spectrum/events/summary?since=2024-01-01T00:00:00Z&until=2024-01-02T00:00:00Z',
				{
					method: 'GET',
					headers: {
						// Valid API token format (20+ alphanumeric chars)
						'X-CF-API-Token': 'test-token-valid-format-1234567890',
						'X-CF-Zone-ID': 'invalid',
					},
				}
			);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(400);
			const data = await response.json();
			expect(data).toHaveProperty('error', 'Invalid Zone ID format');
		});

		it('returns 401 for missing credentials on aggregate/current (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>(
				'http://example.com/api/spectrum/aggregate/current',
				{
					method: 'GET',
				}
			);
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(401);
		});

		it('returns 404 for unknown API endpoints (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/unknown', {
				method: 'GET',
				headers: {
					// Valid API token format (20+ alphanumeric chars)
					'X-CF-API-Token': 'test-token-valid-format-1234567890',
					'X-CF-Zone-ID': 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4',
				},
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(404);
		});
	});

	describe('CORS', () => {
		it('handles OPTIONS preflight requests (unit style)', async () => {
			const request = new Request<unknown, IncomingRequestCfProperties>('http://example.com/api/spectrum/verify', {
				method: 'OPTIONS',
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			expect(response.status).toBe(204);
			expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
			expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
		});

		it('adds CORS headers to API responses (unit style)', async () => {
			// Test with localhost origin (allowed)
			const request = new Request<unknown, IncomingRequestCfProperties>('http://localhost:8787/api/spectrum/verify', {
				method: 'POST',
				headers: { 
					'Content-Type': 'application/json',
					'Origin': 'http://localhost:8787'
				},
				body: JSON.stringify({}),
			});
			const ctx = createExecutionContext();
			const response = await worker.fetch(request, env, ctx);
			await waitOnExecutionContext(ctx);

			// CORS headers should reflect the allowed origin
			expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
			expect(response.headers.get('Vary')).toBe('Origin');
		});
	});
});
