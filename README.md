# Spectrum Analytics Dashboard

A visualization dashboard for Cloudflare Spectrum analytics data, built on Cloudflare Workers with Static Assets.

## Overview

This dashboard allows users to visualize their Spectrum analytics data by providing a read-only API token and Zone ID. The application fetches data from the Cloudflare Spectrum Analytics API and presents it in an intuitive, real-time dashboard.

### Features

- **Real-time Analytics**: View connections, bandwidth, and duration metrics
- **Argo Smart Routing Metrics**: Network optimization insights including response time, throughput, success rate, and P99 latency powered by [Argo Smart Routing](https://developers.cloudflare.com/argo-smart-routing/)
- **Duration Percentiles**: P50, P90, P99 latency analysis for connection performance
- **Event Type Breakdown**: Track connect, disconnect, progress, originError, and clientFiltered events
- **Traffic by Colo**: Top 10 edge locations by connection count
- **IP Version Distribution**: IPv4 vs IPv6 traffic breakdown
- **TCP/HTTPS App Visibility**: Additional charts for throughput, connection health, duration distribution, and bytes per connection
- **Data Export**: Export all metrics to CSV or JSON format for further analysis
- **Events Log**: Recent Spectrum events with timestamps and details
- **Application Filtering**: Filter by specific Spectrum application
- **Spectrum Apps Configuration**: View all app configurations (hostnames, protocols, origins, TLS, Argo, Edge IPs) when Zone Settings Read permission is available
- **Auto-refresh**: Data updates every 30 seconds

## Project Structure

```
cf-spectrum-analytics-dashboard/
├── wrangler.jsonc          # Cloudflare Workers configuration
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── worker-configuration.d.ts # Generated Worker types
├── src/
│   ├── index.ts            # Worker API proxy (main entry point)
│   └── types.ts            # TypeScript type definitions
├── public/
│   ├── index.html          # Dashboard HTML
│   ├── styles.css          # Dark theme CSS (Cloudflare branding)
│   └── app.js              # Frontend JavaScript (Chart.js)
└── test/
    └── index.spec.ts       # Vitest tests
```

## Requirements

- **Node.js**: 18.x or later
- **Cloudflare Account**: With a zone that has Spectrum enabled
- **API Token**: With `Analytics Read` permission (required)
  - **Optional**: Add `Zone Settings Read` permission to see Spectrum application configurations (hostnames, protocols, origins, TLS, Argo Smart Routing)

### Creating an API Token

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > My Profile > API Tokens
2. Click "Create Token"
3. Use the "Custom token" template
4. Add permission: `Zone > Analytics > Read` (required)
5. **Optional**: Add permission: `Zone > Zone Settings > Read` (to see application configurations)
6. Scope to your specific zone or all zones
7. Create and copy the token

For more information, see [Cloudflare API Token Documentation](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

### Permission Details

| Permission | Required | Purpose |
|------------|----------|---------|
| Analytics Read | Yes | Access Spectrum analytics data (connections, bandwidth, events) |
| Zone Settings Read | No | Show Spectrum application configurations (hostnames, protocols, origins, TLS, Argo Smart Routing, Edge IPs, IP Firewall) |

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd cf-spectrum-analytics-dashboard

# Install dependencies
npm install

# Generate TypeScript types for Worker bindings
npm run cf-typegen
```

## Development

```bash
# Start local development server
npm run dev

# Run tests
npm test

# Type check
npx tsc --noEmit
```

The development server runs at `http://localhost:8787` (or `8788` if port is in use).

## Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy
```

## API Endpoints

The Worker provides the following API proxy endpoints:

| Endpoint | Description |
|----------|-------------|
| `POST /api/spectrum/verify` | Verify API token and Zone ID |
| `GET /api/spectrum/events/summary` | Analytics summary with metrics |
| `GET /api/spectrum/events/bytime` | Time-series analytics data |
| `GET /api/spectrum/aggregate/current` | Real-time connection stats |
| `GET /api/spectrum/apps` | List Spectrum apps (requires Spectrum Read permission) |

## Security Features

This application implements enterprise-grade security practices:

### API Token Handling
- **Memory-Only Storage**: API tokens are stored only in JavaScript memory, never in sessionStorage or localStorage
- **Never Server-Stored**: The Worker never persists tokens - they are passed through headers only
- **Format Validation**: API tokens are validated for proper format before use
- **Explicit Cleanup**: Tokens are cleared on disconnect and page unload
- **Form Clearing**: Token input fields are cleared immediately after successful authentication

## Technologies

- **[Cloudflare Workers](https://developers.cloudflare.com/workers/)**: Serverless compute platform
- **[Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)**: Static file hosting
- **[Chart.js](https://www.chartjs.org/)**: Data visualization
- **[Vitest](https://vitest.dev/)**: Testing framework
- **TypeScript**: Type-safe development

## Documentation

- [Spectrum Analytics Reference](https://developers.cloudflare.com/spectrum/reference/analytics/)
- [Spectrum Analytics Events API](https://developers.cloudflare.com/api/resources/spectrum/subresources/analytics/subresources/events/)
- [Argo Smart Routing](https://developers.cloudflare.com/argo-smart-routing/) - Network optimization for TCP/HTTPS apps
- [Find Zone and Account IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

## Data Export

The dashboard supports exporting all metrics data in two formats:

### CSV Export
Exports a structured CSV file containing:
- Summary metrics (connections, bandwidth, duration percentiles)
- Current connections by application
- Time-series data
- Event type breakdown
- Traffic by colo
- IP version distribution

### JSON Export
Exports a JSON file with the same data in a structured format suitable for programmatic analysis or import into other tools.

## Disclaimer

**This project is for educational and demonstration purposes only.**

This is not an official Cloudflare product. It is provided as-is without any warranty or support. Use at your own risk.

It is likely that the analytics do not properly display all data.

### Important Security Notes

1. **API Tokens**: Never use API tokens with write permissions in this or any untrusted application
2. **Read-Only**: This dashboard only requires and should only be used with `Analytics Read` permission
3. **Session Storage**: While tokens are stored in session storage (cleared on tab close), exercise caution on shared computers
4. **No Warranty**: This software is provided without warranty of any kind
