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

## Understanding Spectrum Performance Metrics

This section explains how to interpret the analytics data displayed in the dashboard and how to use it to assess the performance of your Spectrum applications, including those using Argo Smart Routing.

### Data Sources

All metrics in this dashboard come from the [Cloudflare Spectrum Analytics API](https://developers.cloudflare.com/spectrum/reference/analytics/), which provides two main endpoints:

| Endpoint | Purpose | Use Case |
|----------|---------|----------|
| `/events/summary` | Aggregated metrics over a time period | Total connections, bandwidth, duration percentiles |
| `/events/bytime` | Time-series data with intervals | Trends, charts, historical analysis |

### Core Metrics Explained

#### Connection Metrics

| Metric | Description | What It Tells You |
|--------|-------------|-------------------|
| **count** | Total number of connection events | Overall traffic volume to your Spectrum apps |
| **bytesIngress** | Data received from clients (bytes) | Upload traffic / client-to-origin data volume |
| **bytesEgress** | Data sent to clients (bytes) | Download traffic / origin-to-client data volume |

#### Duration Metrics (Latency)

Duration metrics measure **connection lifetime** in milliseconds - from when the connection is established until it closes:

| Metric | Description | Interpretation |
|--------|-------------|----------------|
| **durationAvg** | Average connection duration | Typical connection lifetime across all connections |
| **durationMedian** (P50) | 50th percentile duration | Half of connections are faster than this value |
| **duration90th** (P90) | 90th percentile duration | 90% of connections complete within this time |
| **duration99th** (P99) | 99th percentile duration | Tail latency - slowest 1% of connections |

**How to interpret duration:**
- **Short durations** (< 1 second): Typical for request/response protocols, API calls
- **Long durations** (minutes to hours): Expected for persistent connections (WebSockets, gaming, SSH)
- **High P99 vs P50 gap**: Indicates inconsistent performance; investigate network issues or origin capacity

#### Event Types

Spectrum tracks connection lifecycle events:

| Event | Description | Health Indicator |
|-------|-------------|------------------|
| **connect** | New connection established | Normal traffic |
| **progress** | Data transferred on connection | Active, healthy connections |
| **disconnect** | Connection closed normally | Normal termination |
| **originError** | Connection to origin failed | ⚠️ Origin issues - check origin health |
| **clientFiltered** | Connection blocked by IP rules | Security rules working (or misconfigured) |

**Healthy ratio**: `(connect + progress + disconnect) / total` should be > 95%. High `originError` rates indicate origin server issues.

### Dimensions for Analysis

Break down metrics by these dimensions to identify patterns:

| Dimension | Use Case |
|-----------|----------|
| **appID** | Compare performance across different Spectrum applications |
| **coloName** | Identify regional performance differences (e.g., SFO, LHR, NRT) |
| **ipVersion** | Compare IPv4 vs IPv6 performance |
| **event** | Analyze connection lifecycle and error rates |

### Argo Smart Routing for Spectrum

[Argo Smart Routing](https://developers.cloudflare.com/argo-smart-routing/) optimizes the network path between Cloudflare's edge and your origin server. When enabled for Spectrum applications, it:

1. **Analyzes real-time network conditions** across Cloudflare's global network
2. **Routes traffic through the fastest path** to your origin, avoiding congestion
3. **Reduces latency** by up to 30% on average (varies by geography and network conditions)

#### Enabling Argo for Spectrum Apps

Argo Smart Routing can be enabled per Spectrum application:

1. In the Cloudflare Dashboard, go to **Spectrum**
2. Select your application and click **Configure**
3. Enable **Argo Smart Routing** toggle
4. Available for both **TCP** and **UDP** (beta) applications

#### Measuring Argo Performance

> **Important Note**: There is **no separate "Argo Analytics API" for Spectrum applications**. The dashboard's "Argo Smart Routing" section displays **general Spectrum metrics** as proxies to help assess overall performance. These metrics come from the standard Spectrum Analytics API, not an Argo-specific data source.

The dashboard's "Argo Smart Routing" section displays these derived metrics:

| Metric | Data Source | What It Shows |
|--------|-------------|---------------|
| **Avg Response Time** | `durationAvg` from Spectrum Analytics | Average connection duration (note: this is connection lifetime, not TTFB) |
| **Throughput** | `bytesIngress + bytesEgress` | Total data transferred in the selected time period |
| **Success Rate** | Calculated from event types | `(total - originError - clientFiltered) / total` |
| **P99 Latency** | `duration99th` from Spectrum Analytics | 99th percentile connection duration |

**How to assess Argo's impact on Spectrum apps:**

Since there's no direct Argo-vs-non-Argo comparison API for Spectrum, you need to manually compare:

1. **Baseline without Argo**: Record metrics with Argo disabled for your application
2. **Enable Argo**: Turn on Argo Smart Routing for the Spectrum app
3. **Compare metrics over time**: Look for improvements in:
   - Lower `durationAvg` and `duration99th` values
   - Reduced `originError` event counts
   - More consistent performance across different edge locations (colos)

**Where Argo benefits are typically most visible:**
- Users geographically distant from your origin server
- During periods of network congestion or routing instability
- Cross-region traffic patterns
- Long-lived persistent connections (gaming, real-time apps)

**Note on HTTP vs Spectrum Analytics**: For HTTP/HTTPS traffic proxied through standard Cloudflare (not Spectrum), Cloudflare provides dedicated [Argo Analytics](https://developers.cloudflare.com/argo-smart-routing/analytics/) that directly measures Time-to-First-Byte (TTFB) improvements with and without Argo. This HTTP-specific comparison analytics is **not available** for TCP/UDP Spectrum applications.

#### Argo Configuration in App Details

When viewing Spectrum application configurations (requires Zone Settings Read permission), the "Argo" column shows:
- **Enabled**: Argo Smart Routing is active
- **Disabled**: Using standard Cloudflare routing

### Traffic Analysis by Edge Location (Colo)

The "Traffic by Colo" chart shows connection distribution across Cloudflare data centers:

- **Colo codes** are 3-letter airport codes (SFO = San Francisco, LHR = London Heathrow)
- **High traffic colos** indicate where your users are geographically located
- **Compare duration metrics by colo** to identify regional performance issues
- Use this data to optimize origin placement or enable Argo for better routing

### Practical Performance Analysis

#### Scenario 1: Diagnosing Slow Connections

1. Check **duration percentiles** - large gap between P50 and P99 indicates inconsistency
2. Filter by **coloName** to identify if slowness is regional
3. Check **originError** rates - high rates indicate origin issues
4. If Argo is disabled, consider enabling it for affected applications

#### Scenario 2: Capacity Planning

1. Monitor **count** (connections) and **bytesIngress/bytesEgress** trends
2. Identify peak traffic times using the time-series charts
3. Correlate with **duration** metrics - increasing duration at peak may indicate capacity limits
4. Use **appID** dimension to identify which applications drive the most traffic

#### Scenario 3: Comparing Applications

1. Use the **Application** filter to isolate each app
2. Compare baseline metrics:
   - Connections per hour
   - Average bytes per connection (`bytesEgress / count`)
   - Duration percentiles
3. Applications with Argo enabled should show lower duration metrics

### API Query Examples

Fetch metrics directly using curl:

```bash
# Summary metrics for last hour
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/spectrum/analytics/events/summary?since=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)&until=$(date -u +%Y-%m-%dT%H:%M:%SZ)&metrics=count,bytesIngress,bytesEgress,durationAvg,durationMedian,duration90th,duration99th" \
  -H "Authorization: Bearer {api_token}"

# Time-series by colo for regional analysis
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/spectrum/analytics/events/bytime?since=$(date -u -v-24H +%Y-%m-%dT%H:%M:%SZ)&until=$(date -u +%Y-%m-%dT%H:%M:%SZ)&metrics=count,durationAvg&dimensions=coloName&time_delta=hour" \
  -H "Authorization: Bearer {api_token}"

# Event breakdown to check error rates
curl -X GET "https://api.cloudflare.com/client/v4/zones/{zone_id}/spectrum/analytics/events/summary?since=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)&until=$(date -u +%Y-%m-%dT%H:%M:%SZ)&metrics=count&dimensions=event" \
  -H "Authorization: Bearer {api_token}"
```

### Key Takeaways

1. **Duration metrics** are the primary indicators of connection performance
2. **P99 latency** matters most for user experience - optimize for tail latency
3. **originError rates** above 5% warrant investigation
4. **Argo Smart Routing** provides the most benefit for:
   - Geographically distributed users
   - Long-lived connections (gaming, real-time apps)
   - Applications sensitive to latency
5. Use **colo-level analysis** to identify regional issues
6. **Export data** regularly for long-term trend analysis

## Disclaimer

**This project is for educational and demonstration purposes only.**

This is not an official Cloudflare product. It is provided as-is without any warranty or support. Use at your own risk.

It is likely that the analytics do not properly display all data. AI LLM helped create this entire project; so watch out for potential hallucinations.

### Important Security Notes

1. **API Tokens**: Never use API tokens with write permissions in this or any untrusted application
2. **Read-Only**: This dashboard only requires and should only be used with `Analytics Read` permission
3. **Session Storage**: While tokens are stored in session storage (cleared on tab close), exercise caution on shared computers
4. **No Warranty**: This software is provided without warranty of any kind
