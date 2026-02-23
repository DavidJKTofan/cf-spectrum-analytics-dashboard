/**
 * Spectrum Analytics Dashboard - Frontend Application
 * 
 * This application fetches and visualizes Spectrum analytics data
 * from the Cloudflare API using a user-provided API token.
 * 
 * Security Features:
 * - API token stored only in sessionStorage (cleared on tab/browser close)
 * - Token cleared on explicit disconnect
 * - Cleanup on page unload and visibility change
 * - Input sanitization before display
 * 
 * @see https://developers.cloudflare.com/spectrum/reference/analytics/
 */

// State management
const state = {
    apiToken: null,
    zoneId: null,
    timeRange: '1h',  // Default to last 1 hour
    appFilter: '',
    charts: {
        connections: null,
        bandwidth: null,
        events: null,
        colo: null,
        throughput: null,
        health: null,
        duration: null,
        bytesPerConn: null
    },
    refreshInterval: null,
    // Store metrics data for export
    metricsData: {
        summary: null,
        timeseries: null,
        current: null,
        events: null,
        colos: null,
        ipVersions: null
    },
    // App metadata cache (hostname/DNS names for app IDs)
    // Populated from /api/spectrum/apps if user has Spectrum Read permission
    appMetadata: null,  // Map<appID, {dns: {name, type}, protocol, ...}>
    appMetadataLoaded: false
};

// DOM Elements
const elements = {
    configSection: document.getElementById('configSection'),
    dashboardSection: document.getElementById('dashboardSection'),
    controlsBar: document.getElementById('controlsBar'),
    configForm: document.getElementById('configForm'),
    apiTokenInput: document.getElementById('apiToken'),
    zoneIdInput: document.getElementById('zoneId'),
    timeRangeSelect: document.getElementById('timeRange'),
    appFilterSelect: document.getElementById('appFilter'),
    refreshBtn: document.getElementById('refreshBtn'),
    disconnectBtn: document.getElementById('disconnectBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    loadingOverlay: document.getElementById('loadingOverlay'),
    errorToast: document.getElementById('errorToast'),
    errorMessage: document.getElementById('errorMessage'),
    // Primary Stats
    totalConnections: document.getElementById('totalConnections'),
    ingressBandwidth: document.getElementById('ingressBandwidth'),
    egressBandwidth: document.getElementById('egressBandwidth'),
    avgDuration: document.getElementById('avgDuration'),
    // Duration Percentiles
    durationMedian: document.getElementById('durationMedian'),
    duration90th: document.getElementById('duration90th'),
    duration99th: document.getElementById('duration99th'),
    // Argo Performance Metrics
    argoAvgResponse: document.getElementById('argoAvgResponse'),
    argoThroughput: document.getElementById('argoThroughput'),
    argoSuccessRate: document.getElementById('argoSuccessRate'),
    argoP99Latency: document.getElementById('argoP99Latency'),
    // Event Types
    eventConnect: document.getElementById('eventConnect'),
    eventProgress: document.getElementById('eventProgress'),
    eventDisconnect: document.getElementById('eventDisconnect'),
    eventOriginError: document.getElementById('eventOriginError'),
    eventClientFiltered: document.getElementById('eventClientFiltered'),
    // IP Version
    ipv4Bar: document.getElementById('ipv4Bar'),
    ipv6Bar: document.getElementById('ipv6Bar'),
    ipv4Count: document.getElementById('ipv4Count'),
    ipv6Count: document.getElementById('ipv6Count'),
    // Tables
    currentConnectionsTable: document.getElementById('currentConnectionsTable'),
    eventsLogTable: document.getElementById('eventsLogTable'),
    // Spectrum Apps Configuration (requires Zone Settings Read permission)
    spectrumAppsSection: document.getElementById('spectrumAppsSection'),
    spectrumAppsTable: document.getElementById('spectrumAppsTable')
};

// Time range configurations
const timeRanges = {
    '1h': { hours: 1, step: 'minute' },
    '6h': { hours: 6, step: 'hour' },
    '24h': { hours: 24, step: 'hour' },
    '7d': { days: 7, step: 'day' },
    '30d': { days: 30, step: 'day' }
};

// Chart.js default configuration
Chart.defaults.color = '#8b949e';
Chart.defaults.borderColor = '#30363d';
Chart.defaults.font.family = '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif';

/**
 * Initialize the application
 * Sets up event listeners and security cleanup handlers
 * 
 * Security Note: API tokens are stored only in memory (state object).
 * SessionStorage is used only for zoneId (non-sensitive) to improve UX.
 * Tokens are never persisted and are cleared when the tab closes.
 */
function init() {
    // Check for stored zoneId only (not token - tokens stay in memory only)
    const storedZoneId = sessionStorage.getItem('cf_zone_id');
    
    if (storedZoneId) {
        // Pre-fill zone ID for convenience, but user must re-enter token
        elements.zoneIdInput.value = storedZoneId;
    }
    
    // Event listeners
    elements.configForm.addEventListener('submit', handleConnect);
    elements.timeRangeSelect.addEventListener('change', handleTimeRangeChange);
    elements.appFilterSelect.addEventListener('change', handleAppFilterChange);
    elements.refreshBtn.addEventListener('click', refreshData);
    elements.disconnectBtn.addEventListener('click', handleDisconnect);
    elements.exportCsvBtn.addEventListener('click', exportToCSV);
    elements.exportJsonBtn.addEventListener('click', exportToJSON);
    
    // Security: Clear sensitive data when page is being unloaded
    window.addEventListener('beforeunload', cleanupSensitiveData);
    
    // Security: Clear data when tab becomes hidden (user switches away)
    // This is optional extra security - comment out if it causes UX issues
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            // Clear interval but keep session for when user returns
            if (state.refreshInterval) {
                clearInterval(state.refreshInterval);
                state.refreshInterval = null;
            }
        } else if (document.visibilityState === 'visible' && state.apiToken) {
            // Resume refresh when user returns
            if (!state.refreshInterval) {
                state.refreshInterval = setInterval(refreshData, 30000);
            }
        }
    });
}

/**
 * Security: Clean up sensitive data
 * Called on page unload and explicit disconnect
 * 
 * Note: API token is only stored in memory (state.apiToken), never in storage.
 * Only zoneId is stored in sessionStorage for UX convenience.
 */
function cleanupSensitiveData() {
    // Clear sensitive state (token)
    state.apiToken = null;
    state.zoneId = null;
    
    // Clear refresh interval
    if (state.refreshInterval) {
        clearInterval(state.refreshInterval);
        state.refreshInterval = null;
    }
    
    // Clear sessionStorage (only contains zoneId, but clear anyway on disconnect)
    sessionStorage.removeItem('cf_zone_id');
    
    // Clear form inputs
    if (elements.apiTokenInput) {
        elements.apiTokenInput.value = '';
    }
    if (elements.zoneIdInput) {
        elements.zoneIdInput.value = '';
    }
}

/**
 * Handle form submission to connect to Cloudflare API
 */
async function handleConnect(e) {
    e.preventDefault();
    
    const apiToken = elements.apiTokenInput.value.trim();
    const zoneId = elements.zoneIdInput.value.trim();
    
    if (!apiToken || !zoneId) {
        showError('Please provide both API token and Zone ID');
        return;
    }
    
    showLoading(true);
    
    try {
        // Verify the token by making a test request
        const response = await fetchFromAPI('/api/spectrum/verify', {
            apiToken,
            zoneId
        });
        
        if (response.success) {
            // Store credentials in memory only (token is sensitive)
            state.apiToken = apiToken;
            state.zoneId = zoneId;
            
            // Store only zoneId in sessionStorage (not sensitive, improves UX)
            sessionStorage.setItem('cf_zone_id', zoneId);
            
            // Clear the form input immediately for security
            elements.apiTokenInput.value = '';
            
            showDashboard();
        } else {
            throw new Error(response.error || 'Failed to verify credentials');
        }
    } catch (error) {
        showError(error.message || 'Failed to connect to Cloudflare API');
    } finally {
        showLoading(false);
    }
}

/**
 * Handle disconnect button click
 * Securely clears all sensitive data and resets the UI
 */
function handleDisconnect() {
    // Security: Clean up all sensitive data
    cleanupSensitiveData();
    
    // Destroy charts
    Object.values(state.charts).forEach(chart => {
        if (chart) chart.destroy();
    });
    state.charts = { connections: null, bandwidth: null, events: null, colo: null, throughput: null, health: null, duration: null, bytesPerConn: null };
    
    // Clear metrics data
    state.metricsData = { summary: null, timeseries: null, current: null, events: null, colos: null, ipVersions: null };
    
    // Clear app metadata cache
    state.appMetadata = null;
    state.appMetadataLoaded = false;
    
    // Show config section, hide controls
    elements.dashboardSection.classList.add('hidden');
    elements.controlsBar.classList.add('hidden');
    elements.configSection.classList.remove('hidden');
    elements.refreshBtn.disabled = true;
}

/**
 * Show the dashboard and load data
 */
async function showDashboard() {
    elements.configSection.classList.add('hidden');
    elements.dashboardSection.classList.remove('hidden');
    elements.controlsBar.classList.remove('hidden');
    elements.refreshBtn.disabled = false;
    
    // Initialize charts
    initCharts();
    
    // Try to load app metadata (requires Spectrum Read permission - optional)
    // This will fail gracefully if user only has Analytics Read
    await loadAppMetadata();
    
    // Load initial data
    await refreshData();
    
    // Set up auto-refresh every 30 seconds
    state.refreshInterval = setInterval(refreshData, 30000);
}

/**
 * Initialize Chart.js charts
 */
function initCharts() {
    // Connections over time chart
    const connectionsCtx = document.getElementById('connectionsChart').getContext('2d');
    state.charts.connections = new Chart(connectionsCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Connections',
                data: [],
                borderColor: '#f6821f',
                backgroundColor: 'rgba(246, 130, 31, 0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#21262d' }
                }
            }
        }
    });
    
    // Bandwidth over time chart
    const bandwidthCtx = document.getElementById('bandwidthChart').getContext('2d');
    state.charts.bandwidth = new Chart(bandwidthCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Ingress',
                    data: [],
                    borderColor: '#3fb950',
                    backgroundColor: 'rgba(63, 185, 80, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                },
                {
                    label: 'Egress',
                    data: [],
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end'
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#21262d' },
                    ticks: {
                        callback: value => formatBytes(value)
                    }
                }
            }
        }
    });
    
    // Events by type chart (doughnut)
    const eventsCtx = document.getElementById('eventsChart').getContext('2d');
    state.charts.events = new Chart(eventsCtx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: ['#f6821f', '#3fb950', '#58a6ff', '#a371f7', '#f778ba'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { padding: 16 }
                }
            },
            cutout: '60%'
        }
    });
    
    // Traffic by colo chart (bar)
    const coloCtx = document.getElementById('coloChart').getContext('2d');
    state.charts.colo = new Chart(coloCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [{
                label: 'Connections',
                data: [],
                backgroundColor: '#f6821f',
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#21262d' }
                }
            }
        }
    });
    
    // Throughput over time chart (area)
    const throughputCtx = document.getElementById('throughputChart').getContext('2d');
    state.charts.throughput = new Chart(throughputCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'Total Throughput',
                data: [],
                borderColor: '#a371f7',
                backgroundColor: 'rgba(163, 113, 247, 0.15)',
                fill: true,
                tension: 0.4,
                pointRadius: 2,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#21262d' },
                    ticks: {
                        callback: value => formatBytes(value)
                    }
                }
            }
        }
    });
    
    // Connection health chart (stacked bar)
    const healthCtx = document.getElementById('healthChart').getContext('2d');
    state.charts.health = new Chart(healthCtx, {
        type: 'bar',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Successful',
                    data: [],
                    backgroundColor: '#3fb950',
                    borderRadius: 4
                },
                {
                    label: 'Origin Errors',
                    data: [],
                    backgroundColor: '#f85149',
                    borderRadius: 4
                },
                {
                    label: 'Client Filtered',
                    data: [],
                    backgroundColor: '#d29922',
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end'
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: '#21262d' }
                }
            }
        }
    });
    
    // Duration distribution chart (line with multiple percentiles)
    const durationCtx = document.getElementById('durationChart').getContext('2d');
    state.charts.duration = new Chart(durationCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'P50 (Median)',
                    data: [],
                    borderColor: '#58a6ff',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                },
                {
                    label: 'P90',
                    data: [],
                    borderColor: '#d29922',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                },
                {
                    label: 'P99',
                    data: [],
                    borderColor: '#f85149',
                    backgroundColor: 'transparent',
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end'
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#21262d' },
                    ticks: {
                        callback: value => formatDuration(value)
                    }
                }
            }
        }
    });
    
    // Bytes per connection chart
    const bytesPerConnCtx = document.getElementById('bytesPerConnChart').getContext('2d');
    state.charts.bytesPerConn = new Chart(bytesPerConnCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Avg Ingress/Conn',
                    data: [],
                    borderColor: '#3fb950',
                    backgroundColor: 'rgba(63, 185, 80, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                },
                {
                    label: 'Avg Egress/Conn',
                    data: [],
                    borderColor: '#58a6ff',
                    backgroundColor: 'rgba(88, 166, 255, 0.1)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end'
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8 }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: '#21262d' },
                    ticks: {
                        callback: value => formatBytes(value)
                    }
                }
            }
        }
    });
}

/**
 * Refresh all dashboard data
 */
async function refreshData() {
    showLoading(true);
    
    try {
        const timeConfig = timeRanges[state.timeRange];
        const since = getTimeAgo(timeConfig);
        const until = new Date().toISOString();
        
        // Fetch all data in parallel
        const [summaryData, timeseriesData, currentData, durationTimeseriesData] = await Promise.all([
            fetchAnalyticsSummary(since, until),
            fetchAnalyticsByTime(since, until, timeConfig.step),
            fetchCurrentConnections(),
            fetchDurationByTime(since, until, timeConfig.step)
        ]);
        
        // Store metrics data for export
        state.metricsData.summary = summaryData;
        state.metricsData.timeseries = timeseriesData;
        state.metricsData.current = currentData;
        
        // Update summary stats
        updateSummaryStats(summaryData);
        
        // Update Argo Smart Routing metrics
        updateArgoMetrics(summaryData);
        
        // Update charts
        updateTimeseriesCharts(timeseriesData);
        
        // Update new charts (throughput, health, duration, bytes per connection)
        updateAdditionalCharts(timeseriesData, durationTimeseriesData);
        
        // Update events and colo charts from summary
        updateDistributionCharts(summaryData);
        
        // Update current connections table
        updateCurrentConnectionsTable(currentData);
        
        // Update events log table
        updateEventsLogTable(since, until);
        
        // Update app filter options
        updateAppFilter(currentData);
        
    } catch (error) {
        showError(error.message || 'Failed to fetch analytics data');
    } finally {
        showLoading(false);
    }
}

/**
 * Fetch analytics summary from the API
 */
async function fetchAnalyticsSummary(since, until) {
    const params = new URLSearchParams({
        since,
        until,
        // Include all available metrics including duration percentiles
        metrics: 'count,bytesIngress,bytesEgress,durationAvg,durationMedian,duration90th,duration99th'
    });
    
    if (state.appFilter) {
        params.append('filters', `appID==${state.appFilter}`);
    }
    
    const response = await fetchFromAPI(`/api/spectrum/events/summary?${params}`);
    return response;
}

/**
 * Fetch analytics by time from the API
 */
async function fetchAnalyticsByTime(since, until, step) {
    const params = new URLSearchParams({
        since,
        until,
        metrics: 'count,bytesIngress,bytesEgress',
        time_delta: step
    });
    
    if (state.appFilter) {
        params.append('filters', `appID==${state.appFilter}`);
    }
    
    const response = await fetchFromAPI(`/api/spectrum/events/bytime?${params}`);
    return response;
}

/**
 * Fetch current connections from the API
 */
async function fetchCurrentConnections() {
    const response = await fetchFromAPI('/api/spectrum/aggregate/current');
    return response;
}

/**
 * Fetch duration metrics by time for the duration distribution chart
 */
async function fetchDurationByTime(since, until, step) {
    const params = new URLSearchParams({
        since,
        until,
        metrics: 'count,durationMedian,duration90th,duration99th',
        time_delta: step
    });
    
    if (state.appFilter) {
        params.append('filters', `appID==${state.appFilter}`);
    }
    
    const response = await fetchFromAPI(`/api/spectrum/events/bytime?${params}`);
    return response;
}

/**
 * Update Argo Smart Routing performance metrics
 * These metrics help visualize network optimization performance
 */
function updateArgoMetrics(summaryData) {
    if (!summaryData || !summaryData.result) {
        elements.argoAvgResponse.textContent = '--';
        elements.argoThroughput.textContent = '--';
        elements.argoSuccessRate.textContent = '--';
        elements.argoP99Latency.textContent = '--';
        return;
    }
    
    const totals = summaryData.result.totals || {};
    
    // Average response time (using avg duration as proxy for TTFB)
    const avgDuration = totals.durationAvg || 0;
    elements.argoAvgResponse.textContent = formatDuration(avgDuration);
    
    // Total throughput (ingress + egress)
    const totalThroughput = (totals.bytesIngress || 0) + (totals.bytesEgress || 0);
    elements.argoThroughput.textContent = formatBytes(totalThroughput);
    
    // P99 latency
    const p99Duration = totals.duration99th || 0;
    elements.argoP99Latency.textContent = formatDuration(p99Duration);
    
    // Success rate calculation requires event data - fetch it
    fetchAnalyticsWithDimension('event').then(eventData => {
        if (eventData && eventData.result && eventData.result.data) {
            let totalEvents = 0;
            let errorEvents = 0;
            
            eventData.result.data.forEach(row => {
                const eventType = getDimensionValue(row);
                const count = getMetricValue(row);
                totalEvents += count;
                if (eventType === 'originError' || eventType === 'clientFiltered') {
                    errorEvents += count;
                }
            });
            
            const successRate = totalEvents > 0 ? ((totalEvents - errorEvents) / totalEvents) * 100 : 100;
            elements.argoSuccessRate.textContent = successRate.toFixed(1) + '%';
            
            // Store for export
            state.metricsData.events = eventData;
        }
    });
}

/**
 * Update additional charts (throughput, health, duration distribution, bytes per connection)
 */
function updateAdditionalCharts(timeseriesData, durationTimeseriesData) {
    if (!timeseriesData || !timeseriesData.result) {
        return;
    }
    
    const result = timeseriesData.result;
    
    // Get the metrics order from the query
    const metricsOrder = result.query?.metrics || ['count', 'bytesIngress', 'bytesEgress'];
    const countIndex = metricsOrder.indexOf('count');
    const ingressIndex = metricsOrder.indexOf('bytesIngress');
    const egressIndex = metricsOrder.indexOf('bytesEgress');
    
    // Handle the bytime-specific structure
    if (result.time_intervals && result.data && result.data.length > 0) {
        const timeIntervals = result.time_intervals;
        const metricsData = result.data[0].metrics;
        
        const labels = timeIntervals.map(interval => formatTimestamp(interval[0]));
        
        const connections = countIndex >= 0 && metricsData[countIndex] ? metricsData[countIndex] : [];
        const ingress = ingressIndex >= 0 && metricsData[ingressIndex] ? metricsData[ingressIndex] : [];
        const egress = egressIndex >= 0 && metricsData[egressIndex] ? metricsData[egressIndex] : [];
        
        // Throughput chart (combined ingress + egress)
        const throughput = ingress.map((val, i) => (val || 0) + (egress[i] || 0));
        state.charts.throughput.data.labels = labels;
        state.charts.throughput.data.datasets[0].data = throughput;
        state.charts.throughput.update('none');
        
        // Bytes per connection chart
        const bytesPerConnIngress = connections.map((count, i) => count > 0 ? (ingress[i] || 0) / count : 0);
        const bytesPerConnEgress = connections.map((count, i) => count > 0 ? (egress[i] || 0) / count : 0);
        state.charts.bytesPerConn.data.labels = labels;
        state.charts.bytesPerConn.data.datasets[0].data = bytesPerConnIngress;
        state.charts.bytesPerConn.data.datasets[1].data = bytesPerConnEgress;
        state.charts.bytesPerConn.update('none');
    }
    
    // Update duration distribution chart from separate API call
    if (durationTimeseriesData && durationTimeseriesData.result) {
        const durResult = durationTimeseriesData.result;
        const durMetricsOrder = durResult.query?.metrics || ['count', 'durationMedian', 'duration90th', 'duration99th'];
        const medianIdx = durMetricsOrder.indexOf('durationMedian');
        const p90Idx = durMetricsOrder.indexOf('duration90th');
        const p99Idx = durMetricsOrder.indexOf('duration99th');
        
        if (durResult.time_intervals && durResult.data && durResult.data.length > 0) {
            const durTimeIntervals = durResult.time_intervals;
            const durMetricsData = durResult.data[0].metrics;
            
            const durLabels = durTimeIntervals.map(interval => formatTimestamp(interval[0]));
            
            const p50Data = medianIdx >= 0 && durMetricsData[medianIdx] ? durMetricsData[medianIdx] : [];
            const p90Data = p90Idx >= 0 && durMetricsData[p90Idx] ? durMetricsData[p90Idx] : [];
            const p99Data = p99Idx >= 0 && durMetricsData[p99Idx] ? durMetricsData[p99Idx] : [];
            
            state.charts.duration.data.labels = durLabels;
            state.charts.duration.data.datasets[0].data = p50Data;
            state.charts.duration.data.datasets[1].data = p90Data;
            state.charts.duration.data.datasets[2].data = p99Data;
            state.charts.duration.update('none');
        }
    }
    
    // Update health chart with event data
    updateHealthChart();
}

/**
 * Update the connection health chart with event breakdown over time
 */
async function updateHealthChart() {
    try {
        const timeConfig = timeRanges[state.timeRange];
        const since = getTimeAgo(timeConfig);
        const until = new Date().toISOString();
        
        const params = new URLSearchParams({
            since,
            until,
            metrics: 'count',
            dimensions: 'event',
            time_delta: timeConfig.step
        });
        
        if (state.appFilter) {
            params.append('filters', `appID==${state.appFilter}`);
        }
        
        const response = await fetchFromAPI(`/api/spectrum/events/bytime?${params}`);
        
        if (response && response.result && response.result.time_intervals) {
            const timeIntervals = response.result.time_intervals;
            const labels = timeIntervals.map(interval => formatTimestamp(interval[0]));
            
            // Initialize arrays for each event type
            const successData = new Array(timeIntervals.length).fill(0);
            const errorData = new Array(timeIntervals.length).fill(0);
            const filteredData = new Array(timeIntervals.length).fill(0);
            
            // Process data for each event dimension
            if (response.result.data) {
                response.result.data.forEach(row => {
                    const eventType = getDimensionValue(row);
                    const metrics = row.metrics && row.metrics[0] ? row.metrics[0] : [];
                    
                    for (let i = 0; i < metrics.length; i++) {
                        const count = metrics[i] || 0;
                        if (eventType === 'originError') {
                            errorData[i] += count;
                        } else if (eventType === 'clientFiltered') {
                            filteredData[i] += count;
                        } else if (eventType === 'connect' || eventType === 'disconnect' || eventType === 'progress') {
                            successData[i] += count;
                        }
                    }
                });
            }
            
            state.charts.health.data.labels = labels;
            state.charts.health.data.datasets[0].data = successData;
            state.charts.health.data.datasets[1].data = errorData;
            state.charts.health.data.datasets[2].data = filteredData;
            state.charts.health.update('none');
        }
    } catch (error) {
        console.warn('Could not fetch health chart data:', error.message);
    }
}

/**
 * Export all metrics data to CSV format
 */
function exportToCSV() {
    const data = state.metricsData;
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `spectrum-analytics-${timestamp}.csv`;
    
    let csv = '';
    
    // Summary section
    csv += '# SPECTRUM ANALYTICS EXPORT\n';
    csv += `# Generated: ${new Date().toISOString()}\n`;
    csv += `# Time Range: ${state.timeRange}\n`;
    csv += `# Zone ID: ${state.zoneId}\n\n`;
    
    // Summary metrics
    if (data.summary && data.summary.result && data.summary.result.totals) {
        const totals = data.summary.result.totals;
        csv += '## SUMMARY METRICS\n';
        csv += 'Metric,Value\n';
        csv += `Total Connections,${totals.count || 0}\n`;
        csv += `Bytes Ingress,${totals.bytesIngress || 0}\n`;
        csv += `Bytes Egress,${totals.bytesEgress || 0}\n`;
        csv += `Avg Duration (ms),${totals.durationAvg || 0}\n`;
        csv += `Median Duration (ms),${totals.durationMedian || 0}\n`;
        csv += `90th Percentile Duration (ms),${totals.duration90th || 0}\n`;
        csv += `99th Percentile Duration (ms),${totals.duration99th || 0}\n\n`;
    }
    
    // Current connections
    if (data.current && data.current.result && data.current.result.length > 0) {
        csv += '## CURRENT CONNECTIONS BY APPLICATION\n';
        csv += 'App ID,Connections,Bytes Ingress,Bytes Egress,Avg Duration\n';
        data.current.result.forEach(app => {
            csv += `${app.appID || ''},${app.connections || 0},${app.bytesIngress || 0},${app.bytesEgress || 0},${app.durationAvg || 0}\n`;
        });
        csv += '\n';
    }
    
    // Timeseries data
    if (data.timeseries && data.timeseries.result && data.timeseries.result.time_intervals) {
        csv += '## TIMESERIES DATA\n';
        const timeIntervals = data.timeseries.result.time_intervals;
        const metricsOrder = data.timeseries.result.query?.metrics || ['count', 'bytesIngress', 'bytesEgress'];
        csv += 'Time Start,Time End,' + metricsOrder.join(',') + '\n';
        
        if (data.timeseries.result.data && data.timeseries.result.data.length > 0) {
            const metricsData = data.timeseries.result.data[0].metrics;
            timeIntervals.forEach((interval, i) => {
                const values = metricsOrder.map((_, metricIdx) => 
                    metricsData[metricIdx] ? (metricsData[metricIdx][i] || 0) : 0
                );
                csv += `${interval[0]},${interval[1]},${values.join(',')}\n`;
            });
        }
        csv += '\n';
    }
    
    // Event breakdown
    if (data.events && data.events.result && data.events.result.data) {
        csv += '## EVENT TYPE BREAKDOWN\n';
        csv += 'Event Type,Count\n';
        data.events.result.data.forEach(row => {
            const eventType = getDimensionValue(row);
            const count = getMetricValue(row);
            csv += `${eventType},${count}\n`;
        });
        csv += '\n';
    }
    
    // Colo breakdown
    if (data.colos && data.colos.result && data.colos.result.data) {
        csv += '## TRAFFIC BY COLO\n';
        csv += 'Colo,Count\n';
        data.colos.result.data.forEach(row => {
            const colo = getDimensionValue(row);
            const count = getMetricValue(row);
            csv += `${colo},${count}\n`;
        });
        csv += '\n';
    }
    
    // IP version breakdown
    if (data.ipVersions && data.ipVersions.result && data.ipVersions.result.data) {
        csv += '## IP VERSION DISTRIBUTION\n';
        csv += 'IP Version,Count\n';
        data.ipVersions.result.data.forEach(row => {
            const version = getDimensionValue(row);
            const count = getMetricValue(row);
            csv += `IPv${version},${count}\n`;
        });
    }
    
    downloadFile(csv, filename, 'text/csv');
}

/**
 * Export all metrics data to JSON format
 */
function exportToJSON() {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const filename = `spectrum-analytics-${timestamp}.json`;
    
    const exportData = {
        metadata: {
            generated: new Date().toISOString(),
            timeRange: state.timeRange,
            zoneId: state.zoneId,
            appFilter: state.appFilter || 'All Applications'
        },
        summary: state.metricsData.summary?.result?.totals || null,
        currentConnections: state.metricsData.current?.result || [],
        timeseries: {
            timeIntervals: state.metricsData.timeseries?.result?.time_intervals || [],
            metrics: state.metricsData.timeseries?.result?.query?.metrics || [],
            data: state.metricsData.timeseries?.result?.data?.[0]?.metrics || []
        },
        events: state.metricsData.events?.result?.data?.map(row => ({
            eventType: getDimensionValue(row),
            count: getMetricValue(row)
        })) || [],
        colos: state.metricsData.colos?.result?.data?.map(row => ({
            colo: getDimensionValue(row),
            count: getMetricValue(row)
        })) || [],
        ipVersions: state.metricsData.ipVersions?.result?.data?.map(row => ({
            version: 'IPv' + getDimensionValue(row),
            count: getMetricValue(row)
        })) || []
    };
    
    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, filename, 'application/json');
}

/**
 * Download a file with the given content
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Load Spectrum app metadata to get hostnames for Application IDs
 * This is optional - requires Spectrum Read permission
 * Falls back gracefully if user only has Analytics Read
 */
async function loadAppMetadata() {
    if (state.appMetadataLoaded) return;
    
    try {
        const response = await fetchFromAPI('/api/spectrum/apps');
        
        if (response && response.result && Array.isArray(response.result)) {
            // Build a map of appID -> app metadata
            state.appMetadata = new Map();
            response.result.forEach(app => {
                if (app.id) {
                    state.appMetadata.set(app.id, {
                        dns: app.dns || null,
                        protocol: app.protocol || null,
                        origin_direct: app.origin_direct || null,
                        origin_dns: app.origin_dns || null,
                        tls: app.tls || null,
                        argo_smart_routing: app.argo_smart_routing || false,
                        edge_ips: app.edge_ips || null,
                        ip_firewall: app.ip_firewall || false
                    });
                }
            });
            console.log(`Loaded metadata for ${state.appMetadata.size} Spectrum apps`);
        }
    } catch (error) {
        // Expected to fail with 403 if user only has Analytics Read permission
        // This is fine - we'll just show app IDs without hostnames
        console.log('App metadata not available (requires Spectrum Read permission)');
        state.appMetadata = null;
    }
    
    state.appMetadataLoaded = true;
    
    // Update the Spectrum Apps table if we have metadata
    updateSpectrumAppsTable();
}

/**
 * Update the Spectrum Applications Configuration table
 * Shows detailed app configurations when Zone Settings Read permission is available
 */
function updateSpectrumAppsTable() {
    const section = elements.spectrumAppsSection;
    const table = elements.spectrumAppsTable;
    
    if (!section || !table) return;
    
    // If no app metadata available, keep section hidden
    if (!state.appMetadata || state.appMetadata.size === 0) {
        section.classList.add('hidden');
        return;
    }
    
    // Show the section
    section.classList.remove('hidden');
    
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    
    // Build table rows from app metadata
    const rows = [];
    state.appMetadata.forEach((app, appId) => {
        const hostname = app.dns?.name || appId.substring(0, 12) + '...';
        const dnsType = app.dns?.type || '-';
        const protocol = app.protocol || '-';
        
        // Format origin (could be origin_direct array or origin_dns object)
        let origin = '-';
        if (app.origin_direct && app.origin_direct.length > 0) {
            origin = app.origin_direct.join(', ');
        } else if (app.origin_dns) {
            origin = app.origin_dns.name || '-';
        }
        
        // TLS mode
        const tls = app.tls || 'off';
        const tlsBadgeClass = tls === 'full' || tls === 'strict' ? 'badge-success' : 
                              tls === 'flexible' ? 'badge-warning' : 'badge-neutral';
        
        // Argo Smart Routing
        const argo = app.argo_smart_routing ? 'Enabled' : 'Disabled';
        const argoBadgeClass = app.argo_smart_routing ? 'badge-success' : 'badge-neutral';
        
        // Edge IPs type
        let edgeIps = '-';
        if (app.edge_ips) {
            if (typeof app.edge_ips === 'string') {
                edgeIps = app.edge_ips;
            } else if (app.edge_ips.type) {
                edgeIps = app.edge_ips.type;
                if (app.edge_ips.connectivity) {
                    edgeIps += ` (${app.edge_ips.connectivity})`;
                }
            }
        }
        
        // IP Firewall
        const ipFirewall = app.ip_firewall ? 'Enabled' : 'Disabled';
        const ipFirewallClass = app.ip_firewall ? 'badge-success' : 'badge-neutral';
        
        rows.push(`
            <tr>
                <td>
                    <div class="app-info">
                        <span class="app-hostname">${escapeHtml(hostname)}</span>
                        <span class="app-details">
                            <code class="app-id-small">${escapeHtml(appId.substring(0, 8))}...</code>
                            ${dnsType !== '-' ? `<span class="app-protocol">${escapeHtml(dnsType)}</span>` : ''}
                        </span>
                    </div>
                </td>
                <td><code>${escapeHtml(protocol)}</code></td>
                <td title="${escapeHtml(origin)}">${escapeHtml(origin.length > 30 ? origin.substring(0, 27) + '...' : origin)}</td>
                <td><span class="event-badge ${tlsBadgeClass}">${escapeHtml(tls)}</span></td>
                <td><span class="event-badge ${argoBadgeClass}">${escapeHtml(argo)}</span></td>
                <td>${escapeHtml(edgeIps)}</td>
                <td><span class="event-badge ${ipFirewallClass}">${escapeHtml(ipFirewall)}</span></td>
            </tr>
        `);
    });
    
    if (rows.length > 0) {
        tbody.innerHTML = rows.join('');
    } else {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No Spectrum applications found</td></tr>';
    }
}

/**
 * Get hostname/DNS name for an app ID (if available from app metadata)
 */
function getAppHostname(appId) {
    if (!appId || !state.appMetadata) return null;
    const app = state.appMetadata.get(appId);
    return app?.dns?.name || null;
}

/**
 * Get app protocol (e.g., tcp/22, https) for an app ID
 */
function getAppProtocol(appId) {
    if (!appId || !state.appMetadata) return null;
    const app = state.appMetadata.get(appId);
    return app?.protocol || null;
}

/**
 * Format app ID for display with optional hostname
 * Shows: "hostname (id...)" if hostname available, otherwise "id..."
 */
function formatAppId(appId) {
    if (!appId) return 'Unknown';
    
    const hostname = getAppHostname(appId);
    const shortId = appId.length > 12 ? appId.substring(0, 8) + '...' : appId;
    
    if (hostname) {
        return hostname;
    }
    
    return shortId;
}

/**
 * Format app ID for display with full details (used in tooltips)
 */
function formatAppIdFull(appId) {
    if (!appId) return 'Unknown';
    
    const hostname = getAppHostname(appId);
    const protocol = getAppProtocol(appId);
    
    let details = appId;
    if (hostname) {
        details = `${hostname} (${appId})`;
    }
    if (protocol) {
        details += ` - ${protocol}`;
    }
    
    return details;
}

/**
 * Make an API request through the Worker proxy
 */
async function fetchFromAPI(endpoint, body = null) {
    const options = {
        method: body ? 'POST' : 'GET',
        headers: {
            'Content-Type': 'application/json',
            'X-CF-API-Token': state.apiToken,
            'X-CF-Zone-ID': state.zoneId
        }
    };
    
    if (body) {
        options.body = JSON.stringify(body);
    }
    
    const response = await fetch(endpoint, options);
    const data = await response.json();
    
    if (!response.ok) {
        throw new Error(data.error || `API request failed: ${response.status}`);
    }
    
    return data;
}

/**
 * Update summary statistics display
 * 
 * The Cloudflare API returns data in two possible formats:
 * 1. Totals object with named properties: result.totals.count, result.totals.bytesIngress, etc.
 * 2. Data array with metrics array: result.data[].metrics[] (order matches query.metrics[])
 */
function updateSummaryStats(data) {
    // Reset all stats to default
    const resetStats = () => {
        elements.totalConnections.textContent = '0';
        elements.ingressBandwidth.textContent = '0 B';
        elements.egressBandwidth.textContent = '0 B';
        elements.avgDuration.textContent = '0 ms';
        elements.durationMedian.textContent = '0 ms';
        elements.duration90th.textContent = '0 ms';
        elements.duration99th.textContent = '0 ms';
    };

    if (!data || !data.result) {
        resetStats();
        return;
    }
    
    // Use totals from the API response (most reliable)
    const totals = data.result.totals || {};
    
    // If totals exist, use them directly
    const totalCount = totals.count || 0;
    const totalIngress = totals.bytesIngress || 0;
    const totalEgress = totals.bytesEgress || 0;
    const avgDuration = totals.durationAvg || 0;
    const medianDuration = totals.durationMedian || 0;
    const p90Duration = totals.duration90th || 0;
    const p99Duration = totals.duration99th || 0;
    
    // Update primary stats
    elements.totalConnections.textContent = formatNumber(totalCount);
    elements.ingressBandwidth.textContent = formatBytes(totalIngress);
    elements.egressBandwidth.textContent = formatBytes(totalEgress);
    elements.avgDuration.textContent = formatDuration(avgDuration);
    
    // Update duration percentiles
    elements.durationMedian.textContent = formatDuration(medianDuration);
    elements.duration90th.textContent = formatDuration(p90Duration);
    elements.duration99th.textContent = formatDuration(p99Duration);
}

/**
 * Update timeseries charts with new data
 * 
 * For bytime queries, the Cloudflare API returns a unique structure:
 * - time_intervals: array of [start, end] pairs for each time bucket
 * - data[0].metrics: nested array where metrics[metricIndex][timeIndex] = value
 * 
 * Example: metrics[0] = [count_t0, count_t1, ...], metrics[1] = [ingress_t0, ingress_t1, ...]
 */
function updateTimeseriesCharts(data) {
    if (!data || !data.result) {
        return;
    }
    
    const result = data.result;
    
    // Get the metrics order from the query
    const metricsOrder = result.query?.metrics || ['count', 'bytesIngress', 'bytesEgress'];
    const countIndex = metricsOrder.indexOf('count');
    const ingressIndex = metricsOrder.indexOf('bytesIngress');
    const egressIndex = metricsOrder.indexOf('bytesEgress');
    
    // Handle the bytime-specific structure with time_intervals
    if (result.time_intervals && result.data && result.data.length > 0) {
        const timeIntervals = result.time_intervals;
        const metricsData = result.data[0].metrics;
        
        // Labels from time intervals (use start time)
        const labels = timeIntervals.map(interval => formatTimestamp(interval[0]));
        
        // Extract metrics from nested array structure
        // metricsData[metricIndex][timeIndex]
        const connections = countIndex >= 0 && metricsData[countIndex] 
            ? metricsData[countIndex] 
            : [];
        const ingress = ingressIndex >= 0 && metricsData[ingressIndex] 
            ? metricsData[ingressIndex] 
            : [];
        const egress = egressIndex >= 0 && metricsData[egressIndex] 
            ? metricsData[egressIndex] 
            : [];
        
        // Update connections chart
        state.charts.connections.data.labels = labels;
        state.charts.connections.data.datasets[0].data = connections;
        state.charts.connections.update('none');
        
        // Update bandwidth chart
        state.charts.bandwidth.data.labels = labels;
        state.charts.bandwidth.data.datasets[0].data = ingress;
        state.charts.bandwidth.data.datasets[1].data = egress;
        state.charts.bandwidth.update('none');
        return;
    }
    
    // Fallback: Handle older/different structure with data[].dimensions and data[].metrics
    if (!result.data) {
        return;
    }
    
    const sortedData = [...result.data].sort((a, b) => {
        let aTime, bTime;
        if (Array.isArray(a.dimensions)) {
            aTime = a.dimensions[0] || '';
        } else {
            aTime = a.dimensions?.ts || a.dimensions?.datetime || '';
        }
        if (Array.isArray(b.dimensions)) {
            bTime = b.dimensions[0] || '';
        } else {
            bTime = b.dimensions?.ts || b.dimensions?.datetime || '';
        }
        return aTime.localeCompare(bTime);
    });
    
    const labels = sortedData.map(row => {
        let ts;
        if (Array.isArray(row.dimensions)) {
            ts = row.dimensions[0];
        } else {
            ts = row.dimensions?.ts || row.dimensions?.datetime;
        }
        return formatTimestamp(ts);
    });
    
    const connections = sortedData.map(row => {
        if (Array.isArray(row.metrics)) {
            return row.metrics[countIndex >= 0 ? countIndex : 0] || 0;
        }
        return row.count || 0;
    });
    
    const ingress = sortedData.map(row => {
        if (Array.isArray(row.metrics)) {
            return row.metrics[ingressIndex >= 0 ? ingressIndex : 1] || 0;
        }
        return row.bytesIngress || 0;
    });
    
    const egress = sortedData.map(row => {
        if (Array.isArray(row.metrics)) {
            return row.metrics[egressIndex >= 0 ? egressIndex : 2] || 0;
        }
        return row.bytesEgress || 0;
    });
    
    // Update connections chart
    state.charts.connections.data.labels = labels;
    state.charts.connections.data.datasets[0].data = connections;
    state.charts.connections.update('none');
    
    // Update bandwidth chart
    state.charts.bandwidth.data.labels = labels;
    state.charts.bandwidth.data.datasets[0].data = ingress;
    state.charts.bandwidth.data.datasets[1].data = egress;
    state.charts.bandwidth.update('none');
}

/**
 * Helper to extract dimension value from API response row
 */
function getDimensionValue(row, dimensionIndex = 0) {
    if (Array.isArray(row.dimensions)) {
        return row.dimensions[dimensionIndex] || 'unknown';
    }
    // Fallback for object format
    const keys = Object.keys(row.dimensions || {});
    return row.dimensions?.[keys[0]] || 'unknown';
}

/**
 * Helper to extract metric value from API response row
 */
function getMetricValue(row, metricIndex = 0) {
    if (Array.isArray(row.metrics)) {
        return row.metrics[metricIndex] || 0;
    }
    return row.count || 0;
}

/**
 * Update distribution charts (events and colo)
 */
function updateDistributionCharts(summaryData) {
    // For events chart - fetch with event dimension
    fetchAnalyticsWithDimension('event').then(eventData => {
        if (eventData && eventData.result && eventData.result.data) {
            const labels = eventData.result.data.map(row => getDimensionValue(row));
            const counts = eventData.result.data.map(row => getMetricValue(row));
            
            // Store for export
            state.metricsData.events = eventData;
            
            // Update chart
            state.charts.events.data.labels = labels;
            state.charts.events.data.datasets[0].data = counts;
            state.charts.events.update('none');
            
            // Update event cards
            updateEventCards(eventData.result.data);
        }
    });
    
    // For colo chart - fetch with coloName dimension
    fetchAnalyticsWithDimension('coloName').then(coloData => {
        if (coloData && coloData.result && coloData.result.data) {
            // Store for export
            state.metricsData.colos = coloData;
            
            // Aggregate duplicate colos (API might return multiple entries per colo)
            const coloAggregated = new Map();
            coloData.result.data.forEach(row => {
                const coloName = getDimensionValue(row);
                const count = getMetricValue(row);
                coloAggregated.set(coloName, (coloAggregated.get(coloName) || 0) + count);
            });
            
            // Convert to array, sort by count, and take top 10
            const sorted = Array.from(coloAggregated.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10);
            
            const labels = sorted.map(([colo]) => colo);
            const counts = sorted.map(([, count]) => count);
            
            state.charts.colo.data.labels = labels;
            state.charts.colo.data.datasets[0].data = counts;
            state.charts.colo.update('none');
        }
    });
    
    // For IP version distribution
    fetchAnalyticsWithDimension('ipVersion').then(ipData => {
        if (ipData && ipData.result && ipData.result.data) {
            // Store for export
            state.metricsData.ipVersions = ipData;
            
            updateIPVersionDistribution(ipData.result.data);
        }
    });
}

/**
 * Update event type cards with counts
 * 
 * API returns: data[].dimensions[] (array) and data[].metrics[] (array)
 */
function updateEventCards(eventData) {
    // Create a map of event type to count
    const eventCounts = {};
    eventData.forEach(row => {
        // Handle both formats: dimensions as array or as object
        let eventType;
        if (Array.isArray(row.dimensions)) {
            eventType = row.dimensions[0] || 'unknown';
        } else {
            eventType = row.dimensions?.event || 'unknown';
        }
        
        // Handle both formats: metrics as array or as named property
        let count;
        if (Array.isArray(row.metrics)) {
            count = row.metrics[0] || 0;
        } else {
            count = row.count || 0;
        }
        
        eventCounts[eventType] = (eventCounts[eventType] || 0) + count;
    });
    
    // Update each event card
    elements.eventConnect.textContent = formatNumber(eventCounts['connect'] || 0);
    elements.eventProgress.textContent = formatNumber(eventCounts['progress'] || 0);
    elements.eventDisconnect.textContent = formatNumber(eventCounts['disconnect'] || 0);
    elements.eventOriginError.textContent = formatNumber(eventCounts['originError'] || 0);
    elements.eventClientFiltered.textContent = formatNumber(eventCounts['clientFiltered'] || 0);
}

/**
 * Update IP version distribution bar and labels
 * 
 * API returns: data[].dimensions[] (array) and data[].metrics[] (array)
 */
function updateIPVersionDistribution(ipData) {
    let ipv4Count = 0;
    let ipv6Count = 0;
    
    ipData.forEach(row => {
        // Handle both formats: dimensions as array or as object
        let version;
        if (Array.isArray(row.dimensions)) {
            version = row.dimensions[0];
        } else {
            version = row.dimensions?.ipVersion;
        }
        
        // Handle both formats: metrics as array or as named property
        let count;
        if (Array.isArray(row.metrics)) {
            count = row.metrics[0] || 0;
        } else {
            count = row.count || 0;
        }
        
        if (version === '4') {
            ipv4Count += count;
        } else if (version === '6') {
            ipv6Count += count;
        }
    });
    
    const total = ipv4Count + ipv6Count;
    const ipv4Percent = total > 0 ? (ipv4Count / total) * 100 : 50;
    const ipv6Percent = total > 0 ? (ipv6Count / total) * 100 : 50;
    
    // Update bars
    elements.ipv4Bar.style.width = `${ipv4Percent}%`;
    elements.ipv6Bar.style.width = `${ipv6Percent}%`;
    
    // Update labels with counts and percentages
    elements.ipv4Count.textContent = `${formatNumber(ipv4Count)} (${ipv4Percent.toFixed(1)}%)`;
    elements.ipv6Count.textContent = `${formatNumber(ipv6Count)} (${ipv6Percent.toFixed(1)}%)`;
}

/**
 * Fetch analytics with a specific dimension
 */
async function fetchAnalyticsWithDimension(dimension) {
    const timeConfig = timeRanges[state.timeRange];
    const since = getTimeAgo(timeConfig);
    const until = new Date().toISOString();
    
    const params = new URLSearchParams({
        since,
        until,
        metrics: 'count',
        dimensions: dimension
    });
    
    if (state.appFilter) {
        params.append('filters', `appID==${state.appFilter}`);
    }
    
    return await fetchFromAPI(`/api/spectrum/events/summary?${params}`);
}

/**
 * Update the current connections table
 */
function updateCurrentConnectionsTable(data) {
    const tbody = elements.currentConnectionsTable.querySelector('tbody');
    
    if (!data || !data.result || data.result.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No active connections</td></tr>';
        return;
    }
    
    const rows = data.result.map(app => {
        const appId = app.appID || '';
        const hostname = getAppHostname(appId);
        const protocol = getAppProtocol(appId);
        const tooltipText = formatAppIdFull(appId);
        
        // Build the app display with hostname if available
        let appDisplay;
        if (hostname) {
            appDisplay = `
                <div class="app-info">
                    <span class="app-hostname">${escapeHtml(hostname)}</span>
                    <span class="app-details">
                        <code class="app-id-small">${escapeHtml(appId.substring(0, 8))}...</code>
                        ${protocol ? `<span class="app-protocol">${escapeHtml(protocol)}</span>` : ''}
                    </span>
                </div>
            `;
        } else {
            appDisplay = `<code>${escapeHtml(formatAppId(appId))}</code>`;
        }
        
        return `
            <tr>
                <td title="${escapeHtml(tooltipText)}">${appDisplay}</td>
                <td>${formatNumber(app.connections || 0)}</td>
                <td>${formatBytes(app.bytesIngress || 0)}/s</td>
                <td>${formatBytes(app.bytesEgress || 0)}/s</td>
                <td>${formatDuration(app.durationAvg || 0)}</td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = rows;
}

/**
 * Update the events log table with recent events
 * Uses valid Spectrum Analytics dimensions: event, appID, coloName
 */
async function updateEventsLogTable(since, until) {
    const tbody = elements.eventsLogTable?.querySelector('tbody');
    if (!tbody) return;
    
    try {
        // Fetch events breakdown by event type, app, and colo
        // Note: datetime is NOT a valid dimension for summary endpoint, only for bytime
        const params = new URLSearchParams({
            since,
            until,
            metrics: 'count,bytesIngress,bytesEgress',
            dimensions: 'event,appID,coloName',
            limit: '50',
            sort: '-count'  // Sort by count descending (must be in metrics)
        });
        
        if (state.appFilter) {
            params.append('filters', `appID==${state.appFilter}`);
        }
        
        const response = await fetchFromAPI(`/api/spectrum/events/summary?${params}`);
        
        if (!response || !response.result || !response.result.data || response.result.data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No events in selected time range</td></tr>';
            return;
        }
        
        // Get metrics order from query
        const metricsOrder = response.result.query?.metrics || ['count', 'bytesIngress', 'bytesEgress'];
        const countIdx = metricsOrder.indexOf('count');
        const ingressIdx = metricsOrder.indexOf('bytesIngress');
        const egressIdx = metricsOrder.indexOf('bytesEgress');
        
        // Get dimension order from query
        const dimensionsOrder = response.result.query?.dimensions || ['event', 'appID', 'coloName'];
        const eventIdx = dimensionsOrder.indexOf('event');
        const appIdx = dimensionsOrder.indexOf('appID');
        const coloIdx = dimensionsOrder.indexOf('coloName');
        
        const rows = response.result.data.slice(0, 20).map(row => {
            // Extract dimensions - could be array or object
            let eventType, appId, coloName;
            if (Array.isArray(row.dimensions)) {
                eventType = row.dimensions[eventIdx >= 0 ? eventIdx : 0];
                appId = row.dimensions[appIdx >= 0 ? appIdx : 1];
                coloName = row.dimensions[coloIdx >= 0 ? coloIdx : 2];
            } else {
                eventType = row.dimensions?.event;
                appId = row.dimensions?.appID;
                coloName = row.dimensions?.coloName;
            }
            
            // Extract metrics
            let count, bytesIn, bytesOut;
            if (Array.isArray(row.metrics)) {
                count = row.metrics[countIdx >= 0 ? countIdx : 0] || 0;
                bytesIn = row.metrics[ingressIdx >= 0 ? ingressIdx : 1] || 0;
                bytesOut = row.metrics[egressIdx >= 0 ? egressIdx : 2] || 0;
            } else {
                count = row.count || 0;
                bytesIn = row.bytesIngress || 0;
                bytesOut = row.bytesEgress || 0;
            }
            
            const eventClass = getEventTypeClass(eventType);
            const hostname = getAppHostname(appId);
            const appDisplayText = hostname || formatAppId(appId);
            const tooltipText = formatAppIdFull(appId);
            
            return `
                <tr>
                    <td><span class="event-badge ${eventClass}">${escapeHtml(eventType || 'unknown')}</span></td>
                    <td title="${escapeHtml(tooltipText)}">${escapeHtml(appDisplayText)}</td>
                    <td>${escapeHtml(coloName || '-')}</td>
                    <td>${formatNumber(count)}</td>
                    <td>${formatBytes(bytesIn)}</td>
                    <td>${formatBytes(bytesOut)}</td>
                </tr>
            `;
        }).join('');
        
        tbody.innerHTML = rows;
    } catch (error) {
        console.warn('Could not fetch events log:', error.message);
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Could not load events</td></tr>';
    }
}

/**
 * Get CSS class for event type badge
 */
function getEventTypeClass(eventType) {
    switch (eventType) {
        case 'connect': return 'badge-success';
        case 'disconnect': return 'badge-neutral';
        case 'progress': return 'badge-info';
        case 'originError': return 'badge-error';
        case 'clientFiltered': return 'badge-warning';
        default: return 'badge-neutral';
    }
}

/**
 * Format event timestamp for display
 */
function formatEventTimestamp(ts) {
    if (!ts) return '-';
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Security: Escape HTML to prevent XSS
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Update application filter dropdown with hostnames when available
 */
function updateAppFilter(currentData) {
    const select = elements.appFilterSelect;
    const currentValue = select.value;
    
    // Clear existing options except the "All" option
    while (select.options.length > 1) {
        select.remove(1);
    }
    
    if (currentData && currentData.result && currentData.result.length > 0) {
        currentData.result.forEach(app => {
            if (app.appID) {
                const option = document.createElement('option');
                option.value = app.appID;
                
                // Show hostname if available, otherwise show shortened ID
                const hostname = getAppHostname(app.appID);
                const protocol = getAppProtocol(app.appID);
                
                if (hostname) {
                    option.textContent = protocol ? `${hostname} (${protocol})` : hostname;
                } else {
                    option.textContent = formatAppId(app.appID);
                }
                
                option.title = formatAppIdFull(app.appID);
                select.appendChild(option);
            }
        });
    }
    
    // Restore previous selection if still available
    if (currentValue) {
        select.value = currentValue;
    }
}

/**
 * Debounce utility to prevent rapid repeated calls
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Debounced refresh to prevent rapid API calls
const debouncedRefresh = debounce(refreshData, 300);

/**
 * Handle time range change
 */
function handleTimeRangeChange(e) {
    state.timeRange = e.target.value;
    debouncedRefresh();
}

/**
 * Handle app filter change
 */
function handleAppFilterChange(e) {
    state.appFilter = e.target.value;
    debouncedRefresh();
}

/**
 * Calculate timestamp for time ago
 */
function getTimeAgo(config) {
    const now = new Date();
    if (config.hours) {
        now.setHours(now.getHours() - config.hours);
    } else if (config.days) {
        now.setDate(now.getDate() - config.days);
    }
    return now.toISOString();
}

/**
 * Format a number with commas
 */
function formatNumber(num) {
    return new Intl.NumberFormat().format(Math.round(num));
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Format duration in milliseconds
 */
function formatDuration(ms) {
    if (ms < 1000) return Math.round(ms) + ' ms';
    if (ms < 60000) return (ms / 1000).toFixed(1) + ' s';
    return (ms / 60000).toFixed(1) + ' min';
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts) {
    if (!ts) return '';
    const date = new Date(ts);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    
    // For longer time ranges, include the date
    if (state.timeRange === '7d' || state.timeRange === '30d') {
        return `${month}/${day} ${hours}:${minutes}`;
    }
    return `${hours}:${minutes}`;
}

/**
 * Show/hide loading overlay
 */
function showLoading(show) {
    if (show) {
        elements.loadingOverlay.classList.remove('hidden');
    } else {
        elements.loadingOverlay.classList.add('hidden');
    }
}

/**
 * Show error toast
 */
function showError(message) {
    elements.errorMessage.textContent = message;
    elements.errorToast.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        hideError();
    }, 5000);
}

/**
 * Hide error toast
 */
function hideError() {
    elements.errorToast.classList.add('hidden');
}

// Make hideError available globally for the onclick handler
window.hideError = hideError;

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);
