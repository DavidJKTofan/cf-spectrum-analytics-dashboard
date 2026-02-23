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
    appMetadataLoaded: false,
    // Pending chart data for charts in hidden tabs
    // When a chart is in a hidden tab (display:none), Chart.js can't render it properly
    // We store the data here and apply it when the tab becomes visible
    pendingChartData: {
        events: null,  // { labels: [], data: [] }
        colo: null,    // { labels: [], data: [] }
        throughput: null,
        health: null,
        duration: null,
        bytesPerConn: null
    },
    // Track which tabs have been visited (for deferred chart initialization)
    // Charts are only created when their tab is first visited to avoid display:none issues
    visitedTabs: new Set(['overview'])  // Overview is visible by default
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
    spectrumAppsTable: document.getElementById('spectrumAppsTable'),
    // Navigation
    dashboardNav: document.getElementById('dashboardNav'),
    // Search inputs
    connectionsTableSearch: document.getElementById('connectionsTableSearch'),
    eventsTableSearch: document.getElementById('eventsTableSearch'),
    appsTableSearch: document.getElementById('appsTableSearch'),
    // Sort selects
    connectionsTableSort: document.getElementById('connectionsTableSort'),
    eventsTableSort: document.getElementById('eventsTableSort')
};

// Current UI state for filtering/sorting
const uiState = {
    activeTab: 'overview',
    tableFilters: {
        connections: { search: '', sort: 'connections-desc' },
        events: { search: '', sort: 'count-desc' },
        apps: { search: '', protocolFilter: 'all' }
    },
    // Cache for table data (for client-side filtering)
    tableData: {
        connections: [],
        events: [],
        apps: []
    }
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

// DISABLE all animations to prevent "Cannot read properties of null (reading 'dataset')" errors
// These errors occur when Chart.js tries to animate/render while data is being updated
// or when the chart is resizing due to tab switches
Chart.defaults.animation = false;
Chart.defaults.animations = {
    colors: false,
    x: false,
    y: false
};
Chart.defaults.transitions = {
    active: {
        animation: {
            duration: 0
        }
    },
    resize: {
        animation: {
            duration: 0
        }
    },
    show: {
        animation: {
            duration: 0
        }
    },
    hide: {
        animation: {
            duration: 0
        }
    }
};

// Responsive handling - but disable resize animation
Chart.defaults.responsive = true;
Chart.defaults.maintainAspectRatio = false;
Chart.defaults.resizeDelay = 0;

// Disable hover animations which can also cause null reference errors
Chart.defaults.hover = {
    animationDuration: 0,
    mode: 'nearest',
    intersect: true
};

// Completely disable responsiveAnimationDuration
Chart.defaults.responsiveAnimationDuration = 0;

// Override the default legend label generator to be more defensive
// This prevents "Cannot read properties of null (reading 'dataset')" during legend rendering
const originalGenerateLabels = Chart.defaults.plugins.legend.labels.generateLabels;
Chart.defaults.plugins.legend.labels.generateLabels = function(chart) {
    try {
        // Validate chart and datasets before generating labels
        if (!chart || !chart.data || !chart.data.datasets) {
            return [];
        }
        // Filter out any null/undefined datasets
        const validDatasets = chart.data.datasets.filter(ds => ds != null);
        if (validDatasets.length === 0) {
            return [];
        }
        return originalGenerateLabels.call(this, chart);
    } catch (e) {
        console.warn('Legend label generation error (suppressed):', e.message);
        return [];
    }
};

// Global error handler to catch and suppress Chart.js internal errors
// These errors are cosmetic and don't affect functionality
window.addEventListener('error', function(event) {
    // Check if error is from Chart.js (minified as 6.js or similar)
    if (event.filename && (event.filename.includes('chart') || /\/\d+\.js$/.test(event.filename))) {
        if (event.message && event.message.includes('dataset')) {
            // Suppress Chart.js dataset errors - these are non-fatal
            event.preventDefault();
            console.debug('Suppressed Chart.js internal error:', event.message);
            return true;
        }
    }
});

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
    
    // Tab navigation
    initTabNavigation();
    
    // Collapsible sections
    initCollapsibleSections();
    
    // Table search and sort
    initTableControls();
    
    // Keyboard shortcuts
    initKeyboardShortcuts();
    
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
    
    // Destroy all charts safely
    destroyAllCharts();
    
    // Reset visited tabs so charts can be reinitialized on next connect
    state.visitedTabs = new Set(['overview']);
    
    // Clear pending chart data
    state.pendingChartData = {
        events: null,
        colo: null,
        throughput: null,
        health: null,
        duration: null,
        bytesPerConn: null
    };
    
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
 * Safely destroy all charts
 * Wraps destruction in try-catch to prevent errors from stopping cleanup
 */
function destroyAllCharts() {
    Object.keys(state.charts).forEach(name => {
        try {
            if (state.charts[name]) {
                state.charts[name].destroy();
            }
        } catch (e) {
            console.warn(`Error destroying ${name} chart:`, e.message);
        }
        state.charts[name] = null;
    });
}

/**
 * Safely destroy a single chart by name
 */
function destroyChart(name) {
    try {
        if (state.charts[name]) {
            state.charts[name].destroy();
            state.charts[name] = null;
        }
    } catch (e) {
        console.warn(`Error destroying ${name} chart:`, e.message);
    }
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
 * Common tooltip configuration for dark theme
 */
const darkTooltipConfig = {
    enabled: true,
    backgroundColor: 'rgba(22, 27, 34, 0.95)',
    titleColor: '#f0f6fc',
    bodyColor: '#f0f6fc',
    borderColor: '#30363d',
    borderWidth: 1,
    padding: 10,
    cornerRadius: 6,
    displayColors: true
};

/**
 * Safe tooltip callback helpers to prevent "Cannot read properties of null" errors
 * These guard against null ctx, ctx.dataset, ctx.parsed, etc.
 */
const safeTooltip = {
    // Get parsed Y value safely
    getY: (ctx) => ctx?.parsed?.y ?? 0,
    
    // Get parsed value for doughnut/pie (no x/y)
    getParsed: (ctx) => ctx?.parsed ?? 0,
    
    // Get dataset label safely
    getDatasetLabel: (ctx) => ctx?.dataset?.label ?? '',
    
    // Get data point label safely
    getLabel: (ctx) => ctx?.label ?? '',
    
    // Get dataset data array safely
    getDatasetData: (ctx) => ctx?.dataset?.data ?? [],
    
    // Calculate total from dataset data
    getDatasetTotal: (ctx) => {
        const data = ctx?.dataset?.data;
        if (!data || !Array.isArray(data)) return 0;
        return data.reduce((a, b) => (a || 0) + (b || 0), 0);
    },
    
    // Safe footer total calculation
    getItemsTotal: (items) => {
        if (!items || !Array.isArray(items) || items.length === 0) return 0;
        return items.reduce((sum, item) => sum + (item?.parsed?.y ?? 0), 0);
    },
    
    // Safe title from items array
    getFirstLabel: (items) => {
        if (!items || !Array.isArray(items) || items.length === 0) return '';
        return items[0]?.label ?? '';
    }
};

/**
 * Initialize Chart.js charts with simplified configuration
 * Charts are created lazily when their tab is first visited to avoid display:none rendering issues
 * 
 * All tooltip callbacks use safeTooltip helpers to prevent null reference errors
 */
function initCharts() {
    // Only initialize charts for the Overview tab (visible by default)
    initOverviewCharts();
    
    // Show loading state for charts in other tabs
    showChartLoading('eventsChart');
    showChartLoading('coloChart');
    showChartLoading('throughputChart');
    showChartLoading('healthChart');
    showChartLoading('durationChart');
    showChartLoading('bytesPerConnChart');
}

/**
 * Initialize Overview tab charts (connections, bandwidth)
 */
function initOverviewCharts() {
    if (state.charts.connections) return; // Already initialized
    
    // Connections over time chart
    const connectionsCtx = document.getElementById('connectionsChart')?.getContext('2d');
    if (!connectionsCtx) {
        console.error('Could not get connectionsChart canvas context');
        return;
    }
    
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
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    ...darkTooltipConfig,
                    callbacks: {
                        label: ctx => `Connections: ${formatNumber(safeTooltip.getY(ctx))}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { callback: v => formatNumber(v) } }
            }
        }
    });
    
    // Bandwidth over time chart
    const bandwidthCtx = document.getElementById('bandwidthChart')?.getContext('2d');
    if (!bandwidthCtx) {
        console.error('Could not get bandwidthChart canvas context');
        return;
    }
    
    state.charts.bandwidth = new Chart(bandwidthCtx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                { label: 'Ingress', data: [], borderColor: '#3fb950', backgroundColor: 'rgba(63, 185, 80, 0.1)', fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5 },
                { label: 'Egress', data: [], borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.1)', fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5 }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', align: 'end' },
                tooltip: {
                    ...darkTooltipConfig,
                    callbacks: {
                        label: ctx => `${safeTooltip.getDatasetLabel(ctx)}: ${formatBytes(safeTooltip.getY(ctx))}`
                    }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { callback: v => formatBytes(v) } }
            }
        }
    });
    
    console.log('Overview charts initialized');
}

/**
 * Initialize Events tab charts
 */
function initEventsCharts() {
    if (state.charts.events) return; // Already initialized
    
    hideChartOverlay('eventsChart');
    
    // Events by type chart (doughnut)
    const eventsCtx = document.getElementById('eventsChart')?.getContext('2d');
    if (!eventsCtx) {
        console.error('Could not get eventsChart canvas context');
        showChartError('eventsChart', 'Failed to initialize chart');
        return;
    }
    
    state.charts.events = new Chart(eventsCtx, {
        type: 'doughnut',
        data: {
            labels: [],
            datasets: [{
                data: [],
                backgroundColor: ['#f6821f', '#3fb950', '#58a6ff', '#a371f7', '#f778ba'],
                borderWidth: 0,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', labels: { padding: 16, color: '#f0f6fc', usePointStyle: true } },
                tooltip: {
                    ...darkTooltipConfig,
                    callbacks: {
                        label: ctx => {
                            const total = safeTooltip.getDatasetTotal(ctx);
                            const value = safeTooltip.getParsed(ctx);
                            const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                            return `${safeTooltip.getLabel(ctx)}: ${formatNumber(value)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '60%'
        }
    });
    
    console.log('Events chart initialized');
    
    // Apply any pending data
    const pendingEvents = state.pendingChartData.events;
    if (pendingEvents && state.charts.events?.data?.datasets?.[0]) {
        state.charts.events.data.labels = pendingEvents.labels;
        state.charts.events.data.datasets[0].data = pendingEvents.data;
        safeChartUpdate(state.charts.events, 'none');
        console.log('Applied pending events chart data');
    }
}

/**
 * Initialize Traffic tab charts (throughput, health, duration, bytesPerConn, colo)
 */
function initTrafficCharts() {
    // Check if already initialized
    if (state.charts.throughput) return;
    
    // Hide loading overlays
    hideChartOverlay('throughputChart');
    hideChartOverlay('healthChart');
    hideChartOverlay('durationChart');
    hideChartOverlay('bytesPerConnChart');
    hideChartOverlay('coloChart');
    
    // Throughput over time chart
    const throughputCtx = document.getElementById('throughputChart')?.getContext('2d');
    if (!throughputCtx) {
        console.error('Could not get throughputChart canvas context');
        showChartError('throughputChart', 'Failed to initialize chart');
    } else {
        state.charts.throughput = new Chart(throughputCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [{
                    label: 'Throughput',
                    data: [],
                    borderColor: '#a371f7',
                    backgroundColor: 'rgba(163, 113, 247, 0.15)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 2,
                    pointHoverRadius: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        ...darkTooltipConfig,
                        callbacks: { label: ctx => `Throughput: ${formatBytes(safeTooltip.getY(ctx))}` }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                    y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { callback: v => formatBytes(v) } }
                }
            }
        });
    }
    
    // Connection health chart (stacked bar)
    const healthCtx = document.getElementById('healthChart')?.getContext('2d');
    if (!healthCtx) {
        console.error('Could not get healthChart canvas context');
        showChartError('healthChart', 'Failed to initialize chart');
    } else {
        state.charts.health = new Chart(healthCtx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [
                    { label: 'Successful', data: [], backgroundColor: '#3fb950', borderRadius: 4 },
                    { label: 'Origin Errors', data: [], backgroundColor: '#f85149', borderRadius: 4 },
                    { label: 'Client Filtered', data: [], backgroundColor: '#d29922', borderRadius: 4 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', align: 'end' },
                    tooltip: {
                        ...darkTooltipConfig,
                        callbacks: {
                            label: ctx => `${safeTooltip.getDatasetLabel(ctx)}: ${formatNumber(safeTooltip.getY(ctx))}`,
                            footer: items => `Total: ${formatNumber(safeTooltip.getItemsTotal(items))}`
                        }
                    }
                },
                scales: {
                    x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                    y: { stacked: true, beginAtZero: true, grid: { color: '#21262d' }, ticks: { callback: v => formatNumber(v) } }
                }
            }
        });
    }
    
    // Duration distribution chart
    const durationCtx = document.getElementById('durationChart')?.getContext('2d');
    if (!durationCtx) {
        console.error('Could not get durationChart canvas context');
        showChartError('durationChart', 'Failed to initialize chart');
    } else {
        state.charts.duration = new Chart(durationCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'P50', data: [], borderColor: '#58a6ff', backgroundColor: 'transparent', tension: 0.4, pointRadius: 2, pointHoverRadius: 5 },
                    { label: 'P90', data: [], borderColor: '#d29922', backgroundColor: 'transparent', tension: 0.4, pointRadius: 2, pointHoverRadius: 5 },
                    { label: 'P99', data: [], borderColor: '#f85149', backgroundColor: 'transparent', tension: 0.4, pointRadius: 2, pointHoverRadius: 5 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', align: 'end' },
                    tooltip: {
                        ...darkTooltipConfig,
                        callbacks: { label: ctx => `${safeTooltip.getDatasetLabel(ctx)}: ${formatDuration(safeTooltip.getY(ctx))}` }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                    y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { callback: v => formatDuration(v) } }
                }
            }
        });
    }
    
    // Bytes per connection chart
    const bytesPerConnCtx = document.getElementById('bytesPerConnChart')?.getContext('2d');
    if (!bytesPerConnCtx) {
        console.error('Could not get bytesPerConnChart canvas context');
        showChartError('bytesPerConnChart', 'Failed to initialize chart');
    } else {
        state.charts.bytesPerConn = new Chart(bytesPerConnCtx, {
            type: 'line',
            data: {
                labels: [],
                datasets: [
                    { label: 'Avg Ingress/Conn', data: [], borderColor: '#3fb950', backgroundColor: 'rgba(63, 185, 80, 0.1)', fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5 },
                    { label: 'Avg Egress/Conn', data: [], borderColor: '#58a6ff', backgroundColor: 'rgba(88, 166, 255, 0.1)', fill: true, tension: 0.4, pointRadius: 2, pointHoverRadius: 5 }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'top', align: 'end' },
                    tooltip: {
                        ...darkTooltipConfig,
                        callbacks: { label: ctx => `${safeTooltip.getDatasetLabel(ctx)}: ${formatBytes(safeTooltip.getY(ctx))}` }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } },
                    y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { callback: v => formatBytes(v) } }
                }
            }
        });
    }
    
    // Traffic by colo chart (bar)
    const coloCtx = document.getElementById('coloChart')?.getContext('2d');
    if (!coloCtx) {
        console.error('Could not get coloChart canvas context');
        showChartError('coloChart', 'Failed to initialize chart');
    } else {
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
                    legend: { display: false },
                    tooltip: {
                        ...darkTooltipConfig,
                        callbacks: {
                            title: items => `Edge: ${safeTooltip.getFirstLabel(items)}`,
                            label: ctx => {
                                const total = safeTooltip.getDatasetTotal(ctx);
                                const value = safeTooltip.getY(ctx);
                                const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                                return `Connections: ${formatNumber(value)} (${pct}%)`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#8b949e' } },
                    y: { beginAtZero: true, grid: { color: '#21262d' }, ticks: { color: '#8b949e', callback: v => formatNumber(v) } }
                }
            }
        });
    }
    
    console.log('Traffic charts initialized');
    
    // Apply any pending data for traffic charts
    applyPendingTrafficChartData();
}

/**
 * Apply pending data to traffic charts after initialization
 * All dataset access is guarded to prevent null reference errors
 */
function applyPendingTrafficChartData() {
    // Apply pending colo data
    const pendingColo = state.pendingChartData.colo;
    if (pendingColo && state.charts.colo?.data?.datasets?.[0]) {
        state.charts.colo.data.labels = pendingColo.labels || [];
        state.charts.colo.data.datasets[0].data = pendingColo.data || [];
        safeChartUpdate(state.charts.colo, 'none');
        console.log('Applied pending colo chart data');
    }
    
    // Apply pending throughput data
    const pendingThroughput = state.pendingChartData.throughput;
    if (pendingThroughput && state.charts.throughput?.data?.datasets?.[0]) {
        state.charts.throughput.data.labels = pendingThroughput.labels || [];
        state.charts.throughput.data.datasets[0].data = pendingThroughput.data || [];
        safeChartUpdate(state.charts.throughput, 'none');
        console.log('Applied pending throughput chart data');
    }
    
    // Apply pending health data
    const pendingHealth = state.pendingChartData.health;
    if (pendingHealth && state.charts.health?.data?.datasets) {
        state.charts.health.data.labels = pendingHealth.labels || [];
        if (Array.isArray(pendingHealth.datasets)) {
            pendingHealth.datasets.forEach((data, i) => {
                if (state.charts.health.data.datasets[i]) {
                    state.charts.health.data.datasets[i].data = data || [];
                }
            });
        }
        safeChartUpdate(state.charts.health, 'none');
        console.log('Applied pending health chart data');
    }
    
    // Apply pending duration data
    const pendingDuration = state.pendingChartData.duration;
    if (pendingDuration && state.charts.duration?.data?.datasets) {
        state.charts.duration.data.labels = pendingDuration.labels || [];
        if (Array.isArray(pendingDuration.datasets)) {
            pendingDuration.datasets.forEach((data, i) => {
                if (state.charts.duration.data.datasets[i]) {
                    state.charts.duration.data.datasets[i].data = data || [];
                }
            });
        }
        safeChartUpdate(state.charts.duration, 'none');
        console.log('Applied pending duration chart data');
    }
    
    // Apply pending bytesPerConn data
    const pendingBytesPerConn = state.pendingChartData.bytesPerConn;
    if (pendingBytesPerConn && state.charts.bytesPerConn?.data?.datasets) {
        state.charts.bytesPerConn.data.labels = pendingBytesPerConn.labels || [];
        if (Array.isArray(pendingBytesPerConn.datasets)) {
            pendingBytesPerConn.datasets.forEach((data, i) => {
                if (state.charts.bytesPerConn.data.datasets[i]) {
                    state.charts.bytesPerConn.data.datasets[i].data = data || [];
                }
            });
        }
        safeChartUpdate(state.charts.bytesPerConn, 'none');
        console.log('Applied pending bytesPerConn chart data');
    }
}

/**
 * Initialize charts for a specific tab (called on first tab visit)
 */
function initChartsForTab(tabId) {
    if (state.visitedTabs.has(tabId)) return;
    
    state.visitedTabs.add(tabId);
    console.log(`First visit to ${tabId} tab, initializing charts...`);
    
    switch (tabId) {
        case 'traffic':
            initTrafficCharts();
            break;
        case 'events':
            initEventsCharts();
            break;
        // Overview is initialized at startup
        // Apps and Debug tabs don't have charts
    }
}

/**
 * Refresh all dashboard data
 */
async function refreshData() {
    showLoading(true);
    
    // Add updating class to charts for visual feedback
    document.querySelectorAll('.chart-container').forEach(el => {
        el.classList.add('updating');
    });
    
    try {
        const timeConfig = timeRanges[state.timeRange];
        const since = getTimeAgo(timeConfig);
        const until = new Date().toISOString();
        
        // Fetch all data in parallel
        const [summaryData, timeseriesData, currentData, durationTimeseriesData, appsInRangeData] = await Promise.all([
            fetchAnalyticsSummary(since, until),
            fetchAnalyticsByTime(since, until, timeConfig.step),
            fetchCurrentConnections(),
            fetchDurationByTime(since, until, timeConfig.step),
            fetchAppsInTimeRange(since, until)
        ]);
        
        // Store metrics data for export
        state.metricsData.summary = summaryData;
        state.metricsData.timeseries = timeseriesData;
        state.metricsData.current = currentData;
        state.metricsData.appsInRange = appsInRangeData;
        
        // Update summary stats
        updateSummaryStats(summaryData);
        
        // Update Argo Smart Routing metrics
        updateArgoMetrics(summaryData);
        
        // Update charts with smooth animation
        updateTimeseriesCharts(timeseriesData);
        
        // Update new charts (throughput, health, duration, bytes per connection)
        updateAdditionalCharts(timeseriesData, durationTimeseriesData);
        
        // Update events and colo charts from summary
        updateDistributionCharts(summaryData);
        
        // Update current connections table
        updateCurrentConnectionsTable(currentData);
        
        // Update events log table
        updateEventsLogTable(since, until);
        
        // Update app filter options using apps that had activity in time range
        // This is more accurate than using currentData which only shows last minute
        updateAppFilter(appsInRangeData);
        
    } catch (error) {
        console.error('Error refreshing data:', error);
        showError(error.message || 'Failed to fetch analytics data');
    } finally {
        // Always hide loading overlay
        showLoading(false);
        
        // Remove updating class from charts
        document.querySelectorAll('.chart-container').forEach(el => {
            el.classList.remove('updating');
        });
        
        // Ensure charts are properly sized after data update
        try {
            requestAnimationFrame(() => {
                resizeAllCharts();
            });
        } catch (e) {
            console.warn('Error resizing charts:', e);
        }
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
 * Note: This only returns apps with activity in the LAST MINUTE
 */
async function fetchCurrentConnections() {
    const response = await fetchFromAPI('/api/spectrum/aggregate/current');
    return response;
}

/**
 * Fetch apps that had activity in the given time range
 * Uses events/summary with appID dimension to get historical data
 * This is more accurate than aggregate/current which only shows last minute
 */
async function fetchAppsInTimeRange(since, until) {
    const params = new URLSearchParams({
        since,
        until,
        metrics: 'count,bytesIngress,bytesEgress',
        dimensions: 'appID',
        sort: '-count'  // Sort by most active first
    });
    
    const response = await fetchFromAPI(`/api/spectrum/events/summary?${params}`);
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
 * Update network performance metrics section
 * NOTE: These are general Spectrum Analytics metrics, NOT Argo-specific data.
 * There is no separate "Argo Analytics API" for Spectrum applications.
 * These metrics can be used as proxies to assess overall performance,
 * and users can compare before/after enabling Argo on their apps.
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
 * If charts are not yet initialized (tab not visited), data is stored as pending
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
        
        // Bytes per connection chart data
        const bytesPerConnIngress = connections.map((count, i) => count > 0 ? (ingress[i] || 0) / count : 0);
        const bytesPerConnEgress = connections.map((count, i) => count > 0 ? (egress[i] || 0) / count : 0);
        
        // Store pending data (always store for potential tab switch)
        state.pendingChartData.throughput = { labels, data: throughput };
        state.pendingChartData.bytesPerConn = { 
            labels, 
            datasets: [bytesPerConnIngress, bytesPerConnEgress]
        };
        
        // If chart exists and has valid structure, update it directly
        if (state.charts.throughput?.data?.datasets?.[0]) {
            state.charts.throughput.data.labels = labels;
            state.charts.throughput.data.datasets[0].data = throughput;
            safeChartUpdate(state.charts.throughput);
        }
        
        if (state.charts.bytesPerConn?.data?.datasets?.[0] && state.charts.bytesPerConn?.data?.datasets?.[1]) {
            state.charts.bytesPerConn.data.labels = labels;
            state.charts.bytesPerConn.data.datasets[0].data = bytesPerConnIngress;
            state.charts.bytesPerConn.data.datasets[1].data = bytesPerConnEgress;
            safeChartUpdate(state.charts.bytesPerConn);
        }
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
            
            // Store pending data
            state.pendingChartData.duration = {
                labels: durLabels,
                datasets: [p50Data, p90Data, p99Data]
            };
            
            // If chart exists and has valid structure, update it directly
            if (state.charts.duration?.data?.datasets?.[0] && 
                state.charts.duration?.data?.datasets?.[1] && 
                state.charts.duration?.data?.datasets?.[2]) {
                state.charts.duration.data.labels = durLabels;
                state.charts.duration.data.datasets[0].data = p50Data;
                state.charts.duration.data.datasets[1].data = p90Data;
                state.charts.duration.data.datasets[2].data = p99Data;
                safeChartUpdate(state.charts.duration);
            }
        }
    }
    
    // Update health chart with event data
    updateHealthChart();
}

/**
 * Update the connection health chart with event breakdown over time
 * If chart is not yet initialized (tab not visited), data is stored as pending
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
            
            // Store pending data
            state.pendingChartData.health = {
                labels,
                datasets: [successData, errorData, filteredData]
            };
            
            // If chart exists and has valid structure, update it directly
            if (state.charts.health?.data?.datasets?.[0] && 
                state.charts.health?.data?.datasets?.[1] && 
                state.charts.health?.data?.datasets?.[2]) {
                state.charts.health.data.labels = labels;
                state.charts.health.data.datasets[0].data = successData;
                state.charts.health.data.datasets[1].data = errorData;
                state.charts.health.data.datasets[2].data = filteredData;
                safeChartUpdate(state.charts.health);
            }
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
    
    // If no app metadata available, show message in table
    if (!state.appMetadata || state.appMetadata.size === 0) {
        const tbody = table.querySelector('tbody');
        if (tbody) {
            tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No Spectrum applications found (requires Zone Settings Read permission)</td></tr>';
        }
        updateResultsCount('appsResultsCount', 0, 0);
        return;
    }
    
    // Build apps array from metadata for filtering
    const apps = [];
    state.appMetadata.forEach((app, appId) => {
        apps.push({ appId, ...app });
    });
    
    // Store for filtering
    uiState.tableData.apps = apps;
    
    // Apply any existing filters
    if (uiState.tableFilters.apps.search || uiState.tableFilters.apps.protocolFilter !== 'all') {
        filterAppsTable();
    } else {
        renderAppsTableFiltered(apps);
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
        
        // Update connections chart with animation (guard dataset access)
        if (state.charts.connections?.data?.datasets?.[0]) {
            state.charts.connections.data.labels = labels;
            state.charts.connections.data.datasets[0].data = connections;
            safeChartUpdate(state.charts.connections);
        }
        
        // Update bandwidth chart with animation (guard dataset access)
        if (state.charts.bandwidth?.data?.datasets?.[0] && state.charts.bandwidth?.data?.datasets?.[1]) {
            state.charts.bandwidth.data.labels = labels;
            state.charts.bandwidth.data.datasets[0].data = ingress;
            state.charts.bandwidth.data.datasets[1].data = egress;
            safeChartUpdate(state.charts.bandwidth);
        }
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
    
    // Update connections chart with animation (guard dataset access)
    if (state.charts.connections?.data?.datasets?.[0]) {
        state.charts.connections.data.labels = labels;
        state.charts.connections.data.datasets[0].data = connections;
        safeChartUpdate(state.charts.connections);
    }
    
    // Update bandwidth chart with animation (guard dataset access)
    if (state.charts.bandwidth?.data?.datasets?.[0] && state.charts.bandwidth?.data?.datasets?.[1]) {
        state.charts.bandwidth.data.labels = labels;
        state.charts.bandwidth.data.datasets[0].data = ingress;
        state.charts.bandwidth.data.datasets[1].data = egress;
        safeChartUpdate(state.charts.bandwidth);
    }
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
 * Safely update a chart, catching any Chart.js internal errors
 * Also validates chart is in a valid state before updating
 */
function safeChartUpdate(chart, mode = 'none') {
    if (!chart) return false;
    
    // Check if chart is in a valid state
    if (!chart.canvas || !chart.ctx || !chart.data) {
        console.warn('Chart update skipped - chart in invalid state');
        return false;
    }
    
    try {
        chart.update(mode);
        return true;
    } catch (e) {
        console.warn('Chart update error (non-fatal):', e.message);
        return false;
    }
}

/**
 * Check if a chart instance is valid and can be used
 */
function isChartValid(chart) {
    return chart && chart.canvas && chart.ctx && chart.data && chart.data.datasets;
}

/**
 * Show loading overlay for a chart
 * @param {string} chartId - The canvas element ID (e.g., 'throughputChart')
 */
function showChartLoading(chartId) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;
    
    const container = canvas.closest('.chart-container');
    if (!container) return;
    
    // Remove any existing overlay
    hideChartOverlay(chartId);
    
    // Create loading overlay
    const overlay = document.createElement('div');
    overlay.className = 'chart-loading-overlay';
    overlay.setAttribute('data-chart-overlay', chartId);
    overlay.innerHTML = `
        <div class="spinner"></div>
        <span class="loading-text">Loading chart...</span>
    `;
    
    container.classList.add('has-overlay');
    container.appendChild(overlay);
}

/**
 * Show error overlay for a chart
 * @param {string} chartId - The canvas element ID
 * @param {string} message - Error message to display
 */
function showChartError(chartId, message = 'Failed to load chart data') {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;
    
    const container = canvas.closest('.chart-container');
    if (!container) return;
    
    // Remove any existing overlay
    hideChartOverlay(chartId);
    
    // Create error overlay
    const overlay = document.createElement('div');
    overlay.className = 'chart-error-overlay';
    overlay.setAttribute('data-chart-overlay', chartId);
    overlay.innerHTML = `
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span class="error-title">Chart Error</span>
        <span class="error-message">${escapeHtml(message)}</span>
        <button class="retry-btn" onclick="refreshData()">Retry</button>
    `;
    
    container.classList.add('has-overlay');
    container.appendChild(overlay);
}

/**
 * Hide any overlay (loading or error) for a chart
 * @param {string} chartId - The canvas element ID
 */
function hideChartOverlay(chartId) {
    const canvas = document.getElementById(chartId);
    if (!canvas) return;
    
    const container = canvas.closest('.chart-container');
    if (!container) return;
    
    const overlay = container.querySelector(`[data-chart-overlay="${chartId}"]`);
    if (overlay) {
        overlay.remove();
    }
    container.classList.remove('has-overlay');
}

/**
 * Show loading state for all charts
 */
function showAllChartsLoading() {
    const chartIds = [
        'connectionsChart', 'bandwidthChart', 'eventsChart', 'coloChart',
        'throughputChart', 'healthChart', 'durationChart', 'bytesPerConnChart'
    ];
    chartIds.forEach(id => showChartLoading(id));
}

/**
 * Hide loading state for all charts
 */
function hideAllChartsLoading() {
    const chartIds = [
        'connectionsChart', 'bandwidthChart', 'eventsChart', 'coloChart',
        'throughputChart', 'healthChart', 'durationChart', 'bytesPerConnChart'
    ];
    chartIds.forEach(id => hideChartOverlay(id));
}

/**
 * Apply chart data and handle hidden tab scenario
 * If the chart doesn't exist yet (tab not visited), store data for later.
 * If the chart's tab is hidden, store data for later; otherwise update immediately
 * All dataset access is guarded to prevent null reference errors
 */
function applyChartData(chartName, labels, data, tabId) {
    try {
        // Always store the data for potential re-application on tab switch or chart init
        state.pendingChartData[chartName] = { labels: labels || [], data: data || [] };
        
        const chart = state.charts[chartName];
        
        // If chart doesn't exist yet (tab hasn't been visited), just store data
        if (!chart) {
            console.log(`${chartName} chart not initialized yet, storing data for later`);
            return;
        }
        
        // Guard against missing chart data structure
        if (!chart.data || !chart.data.datasets || !chart.data.datasets[0]) {
            console.warn(`${chartName} chart data structure is invalid`);
            return;
        }
        
        // Check if the tab is currently visible
        const isTabVisible = uiState.activeTab === tabId;
        
        console.log(`Applying ${chartName} chart data:`, { labels, data, isTabVisible, activeTab: uiState.activeTab });
        
        // Update chart data
        chart.data.labels = labels || [];
        chart.data.datasets[0].data = data || [];
        
        if (isTabVisible) {
            // Tab is visible - update immediately (skip animation to avoid race conditions)
            safeChartUpdate(chart, 'none');
            console.log(`${chartName} chart updated (tab visible)`);
        } else {
            // Tab is hidden - just store data, will be applied on tab switch
            console.log(`${chartName} chart data stored (tab hidden, will apply on switch to ${tabId})`);
        }
    } catch (e) {
        console.warn(`Error applying ${chartName} chart data:`, e.message);
    }
}

/**
 * Update distribution charts (events and colo)
 */
function updateDistributionCharts(summaryData) {
    // For events chart - fetch with event dimension
    fetchAnalyticsWithDimension('event').then(eventData => {
        console.log('Event data received:', eventData);
        if (eventData && eventData.result && eventData.result.data && eventData.result.data.length > 0) {
            const labels = eventData.result.data.map(row => getDimensionValue(row));
            const counts = eventData.result.data.map(row => getMetricValue(row));
            
            console.log('Events chart data:', { labels, counts });
            
            // Store for export
            state.metricsData.events = eventData;
            
            // Update event cards first (these are always visible)
            updateEventCards(eventData.result.data);
            
            // Apply to events chart (in 'events' tab)
            applyChartData('events', labels, counts, 'events');
        } else {
            console.log('No event data received');
            // No event data - show placeholder
            applyChartData('events', ['No data'], [1], 'events');
        }
    }).catch(error => {
        console.warn('Could not fetch event distribution:', error.message);
    });
    
    // For colo chart - fetch with coloName dimension
    fetchAnalyticsWithDimension('coloName').then(coloData => {
        console.log('Colo data received:', coloData?.result?.data?.length, 'rows');
        if (coloData && coloData.result && coloData.result.data && coloData.result.data.length > 0) {
            // Store for export
            state.metricsData.colos = coloData;
            
            // Aggregate duplicate colos (API returns multiple entries per colo for different time periods/apps)
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
            
            console.log('Colo chart data:', { labels, counts });
            
            // Apply to colo chart (in 'traffic' tab)
            applyChartData('colo', labels, counts, 'traffic');
        }
    }).catch(error => {
        console.warn('Could not fetch colo distribution:', error.message);
    });
    
    // For IP version distribution
    fetchAnalyticsWithDimension('ipVersion').then(ipData => {
        if (ipData && ipData.result && ipData.result.data) {
            // Store for export
            state.metricsData.ipVersions = ipData;
            
            updateIPVersionDistribution(ipData.result.data);
        }
    }).catch(error => {
        console.warn('Could not fetch IP version distribution:', error.message);
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
    if (!data || !data.result || data.result.length === 0) {
        uiState.tableData.connections = [];
        renderConnectionsTable([]);
        updateResultsCount('connectionsResultsCount', 0, 0);
        return;
    }
    
    // Store data for client-side filtering/sorting
    uiState.tableData.connections = data.result;
    
    // Render table
    renderConnectionsTable(data.result);
    updateResultsCount('connectionsResultsCount', data.result.length, data.result.length);
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
            uiState.tableData.events = [];
            tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No events in selected time range</td></tr>';
            updateResultsCount('eventsResultsCount', 0, 0);
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
        
        // Transform data for storage and rendering
        const eventsData = response.result.data.slice(0, 50).map(row => {
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
            
            return { eventType, appId, coloName, count, bytesIn, bytesOut };
        });
        
        // Store for client-side filtering/sorting
        uiState.tableData.events = eventsData;
        
        // Render table
        renderEventsTable(eventsData);
        updateResultsCount('eventsResultsCount', eventsData.length, eventsData.length);
    } catch (error) {
        console.warn('Could not fetch events log:', error.message);
        uiState.tableData.events = [];
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">Could not load events</td></tr>';
        updateResultsCount('eventsResultsCount', 0, 0);
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
 * 
 * Data comes from events/summary with dimensions=appID, which returns:
 * result.data[].dimensions[0] = appID
 * result.data[].metrics = [count, bytesIngress, bytesEgress]
 * 
 * This shows all apps that had activity in the selected time range,
 * not just apps active in the last minute (which is what aggregate/current returns).
 */
function updateAppFilter(appsData) {
    const select = elements.appFilterSelect;
    const currentValue = select.value;
    
    // Clear existing options except the "All" option
    while (select.options.length > 1) {
        select.remove(1);
    }
    
    // Handle events/summary format: result.data[].dimensions[0] = appID
    if (appsData && appsData.result && appsData.result.data && appsData.result.data.length > 0) {
        // Get metrics order from query to extract count for display
        const metricsOrder = appsData.result.query?.metrics || ['count', 'bytesIngress', 'bytesEgress'];
        const countIdx = metricsOrder.indexOf('count');
        
        appsData.result.data.forEach(row => {
            // Extract appID from dimensions array
            const appID = Array.isArray(row.dimensions) ? row.dimensions[0] : row.dimensions?.appID;
            
            if (appID) {
                const option = document.createElement('option');
                option.value = appID;
                
                // Get event count for this app
                const count = Array.isArray(row.metrics) && countIdx >= 0 ? row.metrics[countIdx] : 0;
                
                // Show hostname if available, otherwise show shortened ID
                const hostname = getAppHostname(appID);
                const protocol = getAppProtocol(appID);
                
                if (hostname) {
                    option.textContent = protocol ? `${hostname} (${protocol})` : hostname;
                } else {
                    option.textContent = formatAppId(appID);
                }
                
                // Add count to tooltip
                option.title = `${formatAppIdFull(appID)} - ${formatNumber(count)} events`;
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

/**
 * Open keyboard shortcuts modal
 */
function openKeyboardModal() {
    const modal = document.getElementById('keyboardShortcutsModal');
    if (modal) {
        modal.classList.remove('hidden');
    }
}

/**
 * Close keyboard shortcuts modal
 */
function closeKeyboardModal() {
    const modal = document.getElementById('keyboardShortcutsModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// Make modal functions available globally
window.openKeyboardModal = openKeyboardModal;
window.closeKeyboardModal = closeKeyboardModal;

/**
 * Initialize tab navigation
 */
function initTabNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.dataset.tab;
            switchTab(tabId);
        });
    });
}

/**
 * Switch to a specific tab
 */
function switchTab(tabId) {
    // Update nav tabs
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabId);
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabId}`);
    });
    
    uiState.activeTab = tabId;
    
    // Initialize charts for this tab if first visit
    // This is done AFTER the tab is visible to avoid display:none issues
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            // Additional delay to ensure layout is complete before creating charts
            setTimeout(() => {
                // Initialize charts on first visit to this tab
                initChartsForTab(tabId);
                
                // Then resize existing charts
                resizeChartsInTab(tabId);
            }, 50);
        });
    });
}

/**
 * Resize all charts - fixes rendering issues after tab switches
 */
function resizeAllCharts() {
    Object.values(state.charts).forEach(chart => {
        if (chart) {
            try {
                chart.resize();
            } catch (e) {
                console.warn('Chart resize error (non-fatal):', e.message);
            }
        }
    });
}

/**
 * Resize charts specific to a tab
 * Maps tab IDs to their chart names
 * 
 * Chart.js doesn't render correctly when canvas has display:none.
 * We need to force a complete re-render after the tab becomes visible.
 * Also re-applies any pending chart data that was stored while the tab was hidden.
 * All dataset access is guarded to prevent null reference errors
 */
function resizeChartsInTab(tabId) {
    const tabCharts = {
        'overview': ['connections', 'bandwidth'],
        'traffic': ['throughput', 'health', 'duration', 'bytesPerConn', 'colo'],
        'events': ['events']
    };
    
    const chartNames = tabCharts[tabId] || [];
    chartNames.forEach(name => {
        const chart = state.charts[name];
        
        // Skip if chart doesn't exist or is invalid
        if (!isChartValid(chart)) {
            console.log(`Skipping ${name} chart - not valid or not initialized`);
            return;
        }
        
        try {
            // Check if there's pending data for this chart that needs to be applied
            const pendingData = state.pendingChartData[name];
            if (pendingData) {
                console.log(`Applying pending data for ${name} chart on tab switch:`, pendingData);
                chart.data.labels = pendingData.labels || [];
                
                // Handle multi-dataset charts (health, duration, bytesPerConn, bandwidth)
                // These have pendingData.datasets array instead of pendingData.data
                if (Array.isArray(pendingData.datasets)) {
                    pendingData.datasets.forEach((dataArray, idx) => {
                        if (chart.data.datasets[idx]) {
                            chart.data.datasets[idx].data = dataArray || [];
                        }
                    });
                } else if (pendingData.data && chart.data.datasets[0]) {
                    // Single dataset charts (connections, throughput, events, colo)
                    chart.data.datasets[0].data = pendingData.data || [];
                }
            }
            
            // After display:none, Chart.js needs a complete resize
            // First resize to trigger dimension recalculation
            try {
                chart.resize();
            } catch (resizeErr) {
                console.warn(`Error resizing ${name} chart:`, resizeErr.message);
            }
            
            // Force a complete re-render with the current data (skip animation)
            if (safeChartUpdate(chart, 'none')) {
                console.log(`${name} chart resized and updated on tab switch to ${tabId}`);
            }
        } catch (e) {
            console.warn(`Error handling ${name} chart on tab switch:`, e.message);
        }
    });
}

/**
 * Apply protocol filter for apps table
 */
function applyProtocolFilter(protocol) {
    uiState.tableFilters.apps.protocolFilter = protocol;
    
    // Update toggle buttons
    document.querySelectorAll('.filter-toggle').forEach(toggle => {
        toggle.classList.toggle('active', toggle.dataset.protocol === protocol);
    });
    
    // Re-render apps table with filter
    filterAppsTable();
}

/**
 * Initialize collapsible sections
 */
function initCollapsibleSections() {
    const headers = document.querySelectorAll('.collapsible-header');
    
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const expanded = header.getAttribute('aria-expanded') === 'true';
            header.setAttribute('aria-expanded', !expanded);
        });
    });
}

/**
 * Initialize table search and sort controls
 */
function initTableControls() {
    // Connections table search
    if (elements.connectionsTableSearch) {
        elements.connectionsTableSearch.addEventListener('input', debounce((e) => {
            uiState.tableFilters.connections.search = e.target.value;
            filterConnectionsTable(e.target.value);
        }, 200));
    }
    
    // Connections table sort
    if (elements.connectionsTableSort) {
        elements.connectionsTableSort.addEventListener('change', (e) => {
            uiState.tableFilters.connections.sort = e.target.value;
            sortConnectionsTable(e.target.value);
        });
    }
    
    // Events table search
    if (elements.eventsTableSearch) {
        elements.eventsTableSearch.addEventListener('input', debounce((e) => {
            uiState.tableFilters.events.search = e.target.value;
            filterEventsTable(e.target.value);
        }, 200));
    }
    
    // Events table sort
    if (elements.eventsTableSort) {
        elements.eventsTableSort.addEventListener('change', (e) => {
            uiState.tableFilters.events.sort = e.target.value;
            sortEventsTable(e.target.value);
        });
    }
    
    // Apps table search
    const appsSearch = document.getElementById('appsTableSearch');
    if (appsSearch) {
        appsSearch.addEventListener('input', debounce((e) => {
            uiState.tableFilters.apps.search = e.target.value;
            filterAppsTable();
        }, 200));
    }
    
    // Apps protocol filter toggles
    document.querySelectorAll('.filter-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => {
            const protocol = toggle.dataset.protocol;
            applyProtocolFilter(protocol);
        });
    });
}

/**
 * Filter connections table by search term
 */
function filterConnectionsTable(searchTerm) {
    const tbody = elements.currentConnectionsTable?.querySelector('tbody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    let visibleCount = 0;
    
    rows.forEach(row => {
        if (row.querySelector('.loading-cell')) return;
        
        const text = row.textContent.toLowerCase();
        const matches = !searchTerm || text.includes(searchTerm.toLowerCase());
        row.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
    });
    
    updateResultsCount('connectionsResultsCount', visibleCount, rows.length);
}

/**
 * Sort connections table
 */
function sortConnectionsTable(sortKey) {
    const data = uiState.tableData.connections;
    if (!data || data.length === 0) return;
    
    const [field, direction] = sortKey.split('-');
    const multiplier = direction === 'asc' ? 1 : -1;
    
    data.sort((a, b) => {
        let aVal, bVal;
        switch (field) {
            case 'connections':
                aVal = a.connections || 0;
                bVal = b.connections || 0;
                break;
            case 'ingress':
                aVal = a.bytesIngress || 0;
                bVal = b.bytesIngress || 0;
                break;
            case 'egress':
                aVal = a.bytesEgress || 0;
                bVal = b.bytesEgress || 0;
                break;
            case 'duration':
                aVal = a.durationAvg || 0;
                bVal = b.durationAvg || 0;
                break;
            default:
                aVal = a.appID || '';
                bVal = b.appID || '';
        }
        return (aVal > bVal ? 1 : -1) * multiplier;
    });
    
    renderConnectionsTable(data);
}

/**
 * Filter events table by search term
 */
function filterEventsTable(searchTerm) {
    const tbody = elements.eventsLogTable?.querySelector('tbody');
    if (!tbody) return;
    
    const rows = tbody.querySelectorAll('tr');
    let visibleCount = 0;
    
    rows.forEach(row => {
        if (row.querySelector('.loading-cell')) return;
        
        const text = row.textContent.toLowerCase();
        const matches = !searchTerm || text.includes(searchTerm.toLowerCase());
        row.style.display = matches ? '' : 'none';
        if (matches) visibleCount++;
    });
    
    updateResultsCount('eventsResultsCount', visibleCount, rows.length);
}

/**
 * Sort events table
 */
function sortEventsTable(sortKey) {
    const data = uiState.tableData.events;
    if (!data || data.length === 0) return;
    
    const [field, direction] = sortKey.split('-');
    const multiplier = direction === 'asc' ? 1 : -1;
    
    data.sort((a, b) => {
        let aVal, bVal;
        switch (field) {
            case 'count':
                aVal = a.count || 0;
                bVal = b.count || 0;
                break;
            case 'bytes':
                aVal = (a.bytesIn || 0) + (a.bytesOut || 0);
                bVal = (b.bytesIn || 0) + (b.bytesOut || 0);
                break;
            case 'type':
                aVal = a.eventType || '';
                bVal = b.eventType || '';
                return aVal.localeCompare(bVal) * multiplier;
            default:
                aVal = a.count || 0;
                bVal = b.count || 0;
        }
        return (aVal > bVal ? 1 : -1) * multiplier;
    });
    
    renderEventsTable(data);
}

/**
 * Filter apps table
 */
function filterAppsTable() {
    if (!state.appMetadata) return;
    
    const searchTerm = uiState.tableFilters.apps.search.toLowerCase();
    const protocolFilter = uiState.tableFilters.apps.protocolFilter;
    
    const filteredApps = [];
    state.appMetadata.forEach((app, appId) => {
        const hostname = app.dns?.name || '';
        const protocol = app.protocol || '';
        const origin = app.origin_direct?.join(', ') || app.origin_dns?.name || '';
        
        // Search filter
        const matchesSearch = !searchTerm || 
            hostname.toLowerCase().includes(searchTerm) ||
            protocol.toLowerCase().includes(searchTerm) ||
            origin.toLowerCase().includes(searchTerm) ||
            appId.toLowerCase().includes(searchTerm);
        
        // Protocol filter
        let matchesProtocol = true;
        if (protocolFilter !== 'all') {
            if (protocolFilter === 'tcp') {
                matchesProtocol = protocol.toLowerCase().startsWith('tcp');
            } else if (protocolFilter === 'https') {
                matchesProtocol = protocol.toLowerCase() === 'https' || protocol.toLowerCase().includes('443');
            } else if (protocolFilter === 'argo') {
                matchesProtocol = app.argo_smart_routing === true;
            }
        }
        
        if (matchesSearch && matchesProtocol) {
            filteredApps.push({ appId, ...app });
        }
    });
    
    renderAppsTableFiltered(filteredApps);
}

/**
 * Render filtered apps table
 */
function renderAppsTableFiltered(apps) {
    const tbody = elements.spectrumAppsTable?.querySelector('tbody');
    if (!tbody) return;
    
    if (apps.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="loading-cell">No applications match your filters</td></tr>';
        updateResultsCount('appsResultsCount', 0, state.appMetadata?.size || 0);
        return;
    }
    
    const rows = apps.map(app => {
        const hostname = app.dns?.name || app.appId.substring(0, 12) + '...';
        const dnsType = app.dns?.type || '-';
        const protocol = app.protocol || '-';
        
        let origin = '-';
        if (app.origin_direct && app.origin_direct.length > 0) {
            origin = app.origin_direct.join(', ');
        } else if (app.origin_dns) {
            origin = app.origin_dns.name || '-';
        }
        
        const tls = app.tls || 'off';
        const tlsBadgeClass = tls === 'full' || tls === 'strict' ? 'badge-success' : 
                              tls === 'flexible' ? 'badge-warning' : 'badge-neutral';
        
        const argo = app.argo_smart_routing ? 'Enabled' : 'Disabled';
        const argoBadgeClass = app.argo_smart_routing ? 'badge-success' : 'badge-neutral';
        
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
        
        const ipFirewall = app.ip_firewall ? 'Enabled' : 'Disabled';
        const ipFirewallClass = app.ip_firewall ? 'badge-success' : 'badge-neutral';
        
        return `
            <tr>
                <td>
                    <div class="app-info">
                        <span class="app-hostname">${escapeHtml(hostname)}</span>
                        <span class="app-details">
                            <code class="app-id-small">${escapeHtml(app.appId.substring(0, 8))}...</code>
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
        `;
    }).join('');
    
    tbody.innerHTML = rows;
    updateResultsCount('appsResultsCount', apps.length, state.appMetadata?.size || 0);
}

/**
 * Render connections table from data
 */
function renderConnectionsTable(data) {
    const tbody = elements.currentConnectionsTable?.querySelector('tbody');
    if (!tbody) return;
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No active connections</td></tr>';
        return;
    }
    
    const rows = data.map(app => {
        const appId = app.appID || '';
        const hostname = getAppHostname(appId);
        const protocol = getAppProtocol(appId);
        const tooltipText = formatAppIdFull(appId);
        
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
 * Render events table from data
 */
function renderEventsTable(data) {
    const tbody = elements.eventsLogTable?.querySelector('tbody');
    if (!tbody) return;
    
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading-cell">No events in selected time range</td></tr>';
        return;
    }
    
    const rows = data.map(row => {
        const eventClass = getEventTypeClass(row.eventType);
        const hostname = getAppHostname(row.appId);
        const appDisplayText = hostname || formatAppId(row.appId);
        const tooltipText = formatAppIdFull(row.appId);
        
        return `
            <tr>
                <td><span class="event-badge ${eventClass}">${escapeHtml(row.eventType || 'unknown')}</span></td>
                <td title="${escapeHtml(tooltipText)}">${escapeHtml(appDisplayText)}</td>
                <td>${escapeHtml(row.coloName || '-')}</td>
                <td>${formatNumber(row.count)}</td>
                <td>${formatBytes(row.bytesIn)}</td>
                <td>${formatBytes(row.bytesOut)}</td>
            </tr>
        `;
    }).join('');
    
    tbody.innerHTML = rows;
}

/**
 * Update results count display
 */
function updateResultsCount(elementId, visible, total) {
    const el = document.getElementById(elementId);
    if (el) {
        if (visible === total) {
            el.textContent = `Showing all ${total} results`;
        } else {
            el.textContent = `Showing ${visible} of ${total} results`;
        }
    }
}

/**
 * Initialize keyboard shortcuts
 */
function initKeyboardShortcuts() {
    // Set up keyboard help button
    const helpBtn = document.getElementById('keyboardHelpBtn');
    if (helpBtn) {
        helpBtn.addEventListener('click', openKeyboardModal);
    }
    
    document.addEventListener('keydown', (e) => {
        // Close modal on Escape
        if (e.key === 'Escape') {
            const modal = document.getElementById('keyboardShortcutsModal');
            if (modal && !modal.classList.contains('hidden')) {
                closeKeyboardModal();
                return;
            }
        }
        
        // Only handle shortcuts when not in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            // Allow Escape to blur from inputs
            if (e.key === 'Escape') {
                e.target.blur();
            }
            return;
        }
        
        // Check if dashboard is visible
        if (elements.dashboardSection.classList.contains('hidden')) return;
        
        switch (e.key) {
            case 'r':
            case 'R':
                // Refresh data
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    refreshData();
                }
                break;
                
            case '1':
                // Switch to Overview tab
                e.preventDefault();
                switchTab('overview');
                break;
                
            case '2':
                // Switch to Traffic tab
                e.preventDefault();
                switchTab('traffic');
                break;
                
            case '3':
                // Switch to Events tab
                e.preventDefault();
                switchTab('events');
                break;
                
            case '4':
                // Switch to Apps tab
                e.preventDefault();
                switchTab('apps');
                break;
                
            case '5':
                // Switch to Debug tab
                e.preventDefault();
                switchTab('debug');
                break;
                
            case '/':
                // Focus search in current tab
                e.preventDefault();
                focusCurrentTabSearch();
                break;
                
            case 'e':
            case 'E':
                // Export (show options)
                if (!e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    // Toggle between CSV and JSON export with shift
                    if (e.shiftKey) {
                        exportToJSON();
                    } else {
                        exportToCSV();
                    }
                }
                break;
                
            case '?':
                // Show keyboard shortcuts help
                e.preventDefault();
                openKeyboardModal();
                break;
        }
    });
}

/**
 * Focus search input in current tab
 */
function focusCurrentTabSearch() {
    switch (uiState.activeTab) {
        case 'events':
            elements.eventsTableSearch?.focus();
            break;
        case 'apps':
            document.getElementById('appsTableSearch')?.focus();
            break;
        default:
            elements.connectionsTableSearch?.focus();
            break;
    }
}

// ========== DEBUG TAB FUNCTIONS ==========

/**
 * Initialize debug tab event listeners
 */
function initDebugTab() {
    const fetchBtn = document.getElementById('fetchDebugData');
    const copyBtn = document.getElementById('copyDebugData');
    
    if (fetchBtn) {
        fetchBtn.addEventListener('click', fetchDebugData);
    }
    if (copyBtn) {
        copyBtn.addEventListener('click', copyDebugDataToClipboard);
    }
    
    // Add click handlers for individual curl copy buttons
    document.querySelectorAll('.btn-copy-curl').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const curlId = btn.dataset.curl;
            const curlEl = document.getElementById(curlId);
            if (curlEl) {
                try {
                    await navigator.clipboard.writeText(curlEl.textContent);
                    btn.classList.add('copied');
                    setTimeout(() => btn.classList.remove('copied'), 1500);
                } catch (err) {
                    // Fallback
                    const textarea = document.createElement('textarea');
                    textarea.value = curlEl.textContent;
                    document.body.appendChild(textarea);
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                    btn.classList.add('copied');
                    setTimeout(() => btn.classList.remove('copied'), 1500);
                }
            }
        });
    });
}

/**
 * Helper to fetch debug data with proper headers
 */
async function fetchDebugEndpoint(endpoint) {
    const response = await fetch(endpoint, {
        headers: {
            'Content-Type': 'application/json',
            'X-CF-API-Token': state.apiToken,
            'X-CF-Zone-ID': state.zoneId
        }
    });
    return response.json();
}

/**
 * Generate a curl command for the Cloudflare API
 * Token is redacted for security
 */
function generateCurlCommand(endpoint, zoneId) {
    const baseUrl = 'https://api.cloudflare.com/client/v4';
    const fullUrl = `${baseUrl}/zones/${zoneId}${endpoint}`;
    return `curl -X GET "${fullUrl}" \\
  -H "Authorization: Bearer YOUR_API_TOKEN" \\
  -H "Content-Type: application/json"`;
}

/**
 * Display curl command in the appropriate element
 */
function displayCurlCommand(elementId, endpoint) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = generateCurlCommand(endpoint, state.zoneId);
    }
}

/**
 * Fetch all raw API data for debugging
 */
async function fetchDebugData() {
    if (!state.apiToken || !state.zoneId) {
        alert('Please connect to the API first');
        return;
    }
    
    const timeConfig = timeRanges[state.timeRange];
    const since = getTimeAgo(timeConfig);
    const until = new Date().toISOString();
    
    // Define all endpoints with their curl and output element IDs
    const endpoints = [
        {
            name: 'Summary',
            path: `/spectrum/analytics/events/summary?since=${since}&until=${until}&metrics=count,bytesIngress,bytesEgress,durationAvg,durationMedian,duration90th,duration99th`,
            localPath: `/api/spectrum/events/summary?since=${since}&until=${until}&metrics=count,bytesIngress,bytesEgress,durationAvg,durationMedian,duration90th,duration99th`,
            curlId: 'curlSummary',
            outputId: 'debugSummary'
        },
        {
            name: 'Timeseries',
            path: `/spectrum/analytics/events/bytime?since=${since}&until=${until}&metrics=count,bytesIngress,bytesEgress&time_delta=${timeConfig.step}`,
            localPath: `/api/spectrum/events/bytime?since=${since}&until=${until}&metrics=count,bytesIngress,bytesEgress&time_delta=${timeConfig.step}`,
            curlId: 'curlTimeseries',
            outputId: 'debugTimeseries'
        },
        {
            name: 'Current',
            path: `/spectrum/analytics/aggregate/current`,
            localPath: `/api/spectrum/aggregate/current`,
            curlId: 'curlCurrent',
            outputId: 'debugCurrent'
        },
        {
            name: 'Events',
            path: `/spectrum/analytics/events/summary?since=${since}&until=${until}&dimensions=event`,
            localPath: `/api/spectrum/events/summary?since=${since}&until=${until}&dimensions=event`,
            curlId: 'curlEvents',
            outputId: 'debugEvents'
        },
        {
            name: 'Colo',
            path: `/spectrum/analytics/events/summary?since=${since}&until=${until}&dimensions=coloName`,
            localPath: `/api/spectrum/events/summary?since=${since}&until=${until}&dimensions=coloName`,
            curlId: 'curlColo',
            outputId: 'debugColo'
        },
        {
            name: 'Apps',
            path: `/spectrum/analytics/events/summary?since=${since}&until=${until}&dimensions=appID`,
            localPath: `/api/spectrum/events/summary?since=${since}&until=${until}&dimensions=appID`,
            curlId: 'curlApps',
            outputId: 'debugApps'
        },
        {
            name: 'SpectrumApps',
            path: `/spectrum/apps`,
            localPath: `/api/spectrum/apps`,
            curlId: 'curlSpectrumApps',
            outputId: 'debugSpectrumApps'
        }
    ];
    
    // Set all panels to loading state and display curl commands
    endpoints.forEach(ep => {
        // Display curl command
        displayCurlCommand(ep.curlId, ep.path);
        
        // Set output to loading
        const outputEl = document.getElementById(ep.outputId);
        if (outputEl) {
            outputEl.textContent = 'Loading...';
            outputEl.className = 'debug-output loading';
        }
    });
    
    // Fetch each endpoint
    for (const ep of endpoints) {
        try {
            const data = await fetchDebugEndpoint(ep.localPath);
            displayDebugData(ep.outputId, data);
        } catch (e) {
            displayDebugError(ep.outputId, e);
        }
    }
}

/**
 * Display debug data in a panel
 */
function displayDebugData(elementId, data) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = JSON.stringify(data, null, 2);
        el.className = 'debug-output';
    }
}

/**
 * Display error in a debug panel
 */
function displayDebugError(elementId, error) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = `Error: ${error.message}`;
        el.className = 'debug-output error';
    }
}

/**
 * Copy all debug data to clipboard
 */
async function copyDebugDataToClipboard() {
    const panels = ['debugSummary', 'debugTimeseries', 'debugCurrent', 'debugEvents', 'debugColo', 'debugApps', 'debugSpectrumApps'];
    const labels = ['Summary API', 'Timeseries API', 'Current Connections', 'Events by Type', 'Traffic by Colo', 'Apps in Range (Analytics)', 'Spectrum Apps Configuration'];
    
    let output = `Spectrum Analytics Debug Data\n`;
    output += `Time Range: ${state.timeRange}\n`;
    output += `Timestamp: ${new Date().toISOString()}\n`;
    output += `${'='.repeat(60)}\n\n`;
    
    panels.forEach((id, i) => {
        const el = document.getElementById(id);
        output += `## ${labels[i]}\n`;
        output += `${'─'.repeat(40)}\n`;
        output += el ? el.textContent : 'Not loaded';
        output += '\n\n';
    });
    
    try {
        await navigator.clipboard.writeText(output);
        alert('Debug data copied to clipboard!');
    } catch (e) {
        console.error('Failed to copy:', e);
        // Fallback: select text
        const textarea = document.createElement('textarea');
        textarea.value = output;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        alert('Debug data copied to clipboard!');
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    init();
    initDebugTab();
});
