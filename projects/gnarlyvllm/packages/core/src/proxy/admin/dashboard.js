let currentPage = 1;
let currentLimit = 25;
let currentFilters = {};
let currentLogId = null;
let currentLogData = null;
let viewMode = 'rendered';
let isInternalNav = false;

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString();
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(1) + 's';
}

function formatTokens(prompt, completion) {
  if (!prompt && !completion) return '-';
  return (prompt || 0) + ' -> ' + (completion || 0);
}

function statusClass(code) {
  if (!code) return '';
  if (code >= 200 && code < 300) return 'status-200';
  if (code >= 400 && code < 500) return 'status-400';
  return 'status-500';
}

function getPtBadgeClass(type) {
  if (!type) return 'pt-unknown';
  return 'pt-' + type;
}

function getPtLabel(type) {
  if (!type) return '-';
  return type;
}

// --- URL / Bookmarking ---

function readUrlParams() {
  const url = new URL(window.location.href);
  const page = parseInt(url.searchParams.get('page'), 10);
  if (!isNaN(page)) currentPage = page;

  const model = url.searchParams.get('model');
  const path = url.searchParams.get('path');
  const promptType = url.searchParams.get('prompt_type');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  return { model, path, promptType, start, end };
}

function applyUrlParamsToDropdowns(params) {
  const modelSelect = document.getElementById('filter-model');
  const pathSelect = document.getElementById('filter-path');
  const ptSelect = document.getElementById('filter-prompt-type');

  if (params.model && Array.from(modelSelect.options).some(o => o.value === params.model)) {
    modelSelect.value = params.model;
  }
  if (params.path && Array.from(pathSelect.options).some(o => o.value === params.path)) {
    pathSelect.value = params.path;
  }
  if (params.promptType && Array.from(ptSelect.options).some(o => o.value === params.promptType)) {
    ptSelect.value = params.promptType;
  }
  if (params.start) {
    document.getElementById('filter-start').value = new Date(parseInt(params.start, 10)).toISOString().slice(0, 16);
  }
  if (params.end) {
    document.getElementById('filter-end').value = new Date(parseInt(params.end, 10)).toISOString().slice(0, 16);
  }
}

function buildFilterObject() {
  const model = document.getElementById('filter-model').value;
  const path = document.getElementById('filter-path').value;
  const promptType = document.getElementById('filter-prompt-type').value;
  const startEl = document.getElementById('filter-start');
  const endEl = document.getElementById('filter-end');

  const filters = {};
  if (model) filters.model = model;
  if (path) filters.path = path;
  if (promptType) filters.prompt_type = promptType;
  if (startEl.value) filters.start = new Date(startEl.value).getTime();
  if (endEl.value) filters.end = new Date(endEl.value).getTime();
  return filters;
}

function updateUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete('page');
  url.searchParams.delete('model');
  url.searchParams.delete('path');
  url.searchParams.delete('prompt_type');
  url.searchParams.delete('start');
  url.searchParams.delete('end');

  if (currentPage > 1) url.searchParams.set('page', String(currentPage));

  const model = document.getElementById('filter-model').value;
  const path = document.getElementById('filter-path').value;
  const promptType = document.getElementById('filter-prompt-type').value;
  const startEl = document.getElementById('filter-start');
  const endEl = document.getElementById('filter-end');

  if (model) url.searchParams.set('model', model);
  if (path) url.searchParams.set('path', path);
  if (promptType) url.searchParams.set('prompt_type', promptType);
  if (startEl.value) url.searchParams.set('start', String(new Date(startEl.value).getTime()));
  if (endEl.value) url.searchParams.set('end', String(new Date(endEl.value).getTime()));

  window.history.replaceState({}, '', url.toString());
}

function updateHash() {
  isInternalNav = true;
  if (currentLogId) {
    window.location.hash = 'log=' + currentLogId;
  } else {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  setTimeout(() => { isInternalNav = false; }, 50);
}

function readHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#log=')) {
    return hash.slice(5);
  }
  return null;
}

window.addEventListener('hashchange', () => {
  if (isInternalNav) return;
  const logId = readHash();
  if (logId && logId !== currentLogId) {
    showDetail(logId);
  } else if (!logId && currentLogId) {
    closeModal();
  }
});

// --- Content rendering ---

function parseSseChunks(text) {
  const chunks = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6).trim();
      if (data === '[DONE]') continue;
      try { chunks.push(JSON.parse(data)); } catch {}
    }
  }
  return chunks;
}

function extractTextFromChunks(chunks) {
  return chunks.map(c => c.choices?.[0]?.delta?.content || '').join('');
}

function parseThinkTags(text) {
  const parts = [];
  const thinkRegex = /<(\/?)think>/g;
  let lastIndex = 0;
  let inThink = false;
  let match;
  while ((match = thinkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: inThink ? 'think' : 'text', content: text.slice(lastIndex, match.index) });
    }
    inThink = match[1] !== '/';
    lastIndex = thinkRegex.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: inThink ? 'think' : 'text', content: text.slice(lastIndex) });
  if (parts.length === 0) parts.push({ type: 'text', content: text });
  return parts;
}

function renderMessage(msg) {
  const roleClass = 'msg-role-' + (msg.role || 'unknown');
  const msgClass = 'msg msg-' + (msg.role || 'system');
  let content = msg.content || '';
  if (msg.role === 'assistant' && content.includes('<think')) {
    const parts = parseThinkTags(content);
    let html = '';
    for (const part of parts) {
      if (part.type === 'think') {
        html += '<div class="think-block"><div class="think-label">Thinking</div>' + escapeHtml(part.content) + '</div>';
      } else {
        html += '<div class="msg-body"><p>' + escapeHtml(part.content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p></div>';
      }
    }
    return '<div class="' + msgClass + '"><div class="msg-role ' + roleClass + '">' + msg.role + '</div>' + html + '</div>';
  }
  const bodyHtml = escapeHtml(content).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  return '<div class="' + msgClass + '"><div class="msg-role ' + roleClass + '">' + msg.role + '</div><div class="msg-body"><p>' + bodyHtml + '</p></div></div>';
}

function renderRequestBody(bodyText, path) {
  if (!bodyText) return '<div class="empty-state">No request body</div>';
  if (path === '/v1/chat/completions') {
    try {
      const parsed = JSON.parse(bodyText);
      const messages = parsed.messages || [];
      if (messages.length === 0) return '<div class="empty-state">No messages in request</div>';
      return messages.map(renderMessage).join('');
    } catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
  }
  if (path === '/v1/embeddings') {
    try {
      const parsed = JSON.parse(bodyText);
      return '<div class="msg msg-system"><div class="msg-role msg-role-system">Input</div><div class="msg-body"><p>' + escapeHtml(JSON.stringify(parsed.input || parsed, null, 2)) + '</p></div></div>' +
             '<div class="msg msg-system"><div class="msg-role msg-role-system">Model</div><div class="msg-body"><p>' + escapeHtml(parsed.model || 'unknown') + '</p></div></div>';
    } catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
  }
  if (path === '/v1/rerank') {
    try {
      const parsed = JSON.parse(bodyText);
      return '<div class="msg msg-system"><div class="msg-role msg-role-system">Query</div><div class="msg-body"><p>' + escapeHtml(parsed.query || '') + '</p></div></div>' +
             '<div class="msg msg-system"><div class="msg-role msg-role-system">Documents</div><div class="msg-body"><p>' + escapeHtml(JSON.stringify(parsed.documents || [], null, 2)) + '</p></div></div>';
    } catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
  }
  try { return '<div class="raw-code">' + escapeHtml(JSON.stringify(JSON.parse(bodyText), null, 2)) + '</div>'; }
  catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
}

function renderResponseBody(bodyText, path) {
  if (!bodyText) return '<div class="empty-state">No response body</div>';
  if (path === '/v1/chat/completions') {
    if (bodyText.includes('data:')) {
      const chunks = parseSseChunks(bodyText);
      const text = extractTextFromChunks(chunks);
      if (!text) return '<div class="empty-state">No text content in stream</div>';
      return '<div class="msg msg-assistant"><div class="msg-role msg-role-assistant">assistant</div><div class="msg-body"><p>' + escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p></div></div>';
    }
    try {
      const parsed = JSON.parse(bodyText);
      const content = parsed.choices?.[0]?.message?.content || '';
      if (content) return renderMessage({ role: 'assistant', content });
      return '<div class="raw-code">' + escapeHtml(JSON.stringify(parsed, null, 2)) + '</div>';
    } catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
  }
  if (path === '/v1/embeddings') {
    try {
      const parsed = JSON.parse(bodyText);
      const count = parsed.data?.length || 0;
      return '<div class="msg msg-system"><div class="msg-role msg-role-system">Result</div><div class="msg-body"><p>Generated ' + count + ' embedding vectors</p></div></div>';
    } catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
  }
  if (path === '/v1/rerank') {
    try {
      const parsed = JSON.parse(bodyText);
      const results = parsed.results || [];
      if (results.length === 0) return '<div class="empty-state">No rerank results</div>';
      let html = '<div class="msg msg-system"><div class="msg-role msg-role-system">Results</div>';
      for (const r of results) html += '<div class="msg-body"><p>[' + r.index + '] Score: ' + (r.relevance_score || r.score || 'N/A') + '</p></div>';
      html += '</div>';
      return html;
    } catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
  }
  try { return '<div class="raw-code">' + escapeHtml(JSON.stringify(JSON.parse(bodyText), null, 2)) + '</div>'; }
  catch { return '<div class="raw-code">' + escapeHtml(bodyText) + '</div>'; }
}

function renderModalContent(log) {
  const path = log.path || '';
  if (viewMode === 'raw') {
    return '<div class="modal-panes">' +
      '<div class="pane pane-left"><div class="pane-header">Request (raw)</div><div class="pane-content"><div class="raw-code">' + escapeHtml(log.request_body || 'No body') + '</div></div></div>' +
      '<div class="pane"><div class="pane-header">Response (raw)</div><div class="pane-content"><div class="raw-code">' + escapeHtml(log.response_body || 'No body') + '</div></div></div>' +
    '</div>' +
    (log.error_message ? '<div style="padding: 12px 16px; border-top: 1px solid #30363d; color: #f85149;"><strong>Error:</strong> ' + escapeHtml(log.error_message) + '</div>' : '');
  }
  return '<div class="modal-panes">' +
    '<div class="pane pane-left"><div class="pane-header">Request</div><div class="pane-content">' + renderRequestBody(log.request_body, path) + '</div></div>' +
    '<div class="pane"><div class="pane-header">Response</div><div class="pane-content">' + renderResponseBody(log.response_body, path) + '</div></div>' +
  '</div>' +
  (log.error_message ? '<div style="padding: 12px 16px; border-top: 1px solid #30363d; color: #f85149;"><strong>Error:</strong> ' + escapeHtml(log.error_message) + '</div>' : '');
}

function setViewMode(mode) {
  viewMode = mode;
  document.getElementById('view-rendered').className = mode === 'rendered' ? 'active' : '';
  document.getElementById('view-raw').className = mode === 'raw' ? 'active' : '';
  if (currentLogData) document.getElementById('modal-body').innerHTML = renderModalContent(currentLogData);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- Dashboard data loading ---

async function loadData() {
  try {
    // Load stats
    const statsRes = await fetch('/admin/api/stats?' + new URLSearchParams(currentFilters));
    const stats = await statsRes.json();
    document.getElementById('stat-total').textContent = stats.totalRequests.toLocaleString();
    document.getElementById('stat-avg').textContent = formatDuration(stats.avgDurationMs);
    document.getElementById('stat-prompt').textContent = stats.totalPromptTokens.toLocaleString();
    document.getElementById('stat-completion').textContent = stats.totalCompletionTokens.toLocaleString();

    // Update model filter
    const modelSelect = document.getElementById('filter-model');
    const currentModel = modelSelect.value;
    modelSelect.innerHTML = '<option value="">All Models</option>' +
      stats.topModels.map(m => '<option value="' + m.model + '">' + m.model + '</option>').join('');
    modelSelect.value = currentModel;

    // Update prompt type filter
    const ptSelect = document.getElementById('filter-prompt-type');
    const currentPt = ptSelect.value;
    const ptOptions = stats.topPromptTypes.map(p => '<option value="' + p.prompt_type + '">' + p.prompt_type + '</option>').join('');
    ptSelect.innerHTML = '<option value="">All Types</option>' + ptOptions;
    ptSelect.value = currentPt;

    // Load logs
    const params = new URLSearchParams({ page: currentPage, limit: currentLimit, ...currentFilters });
    const logsRes = await fetch('/admin/api/logs?' + params);
    const data = await logsRes.json();

    renderLogs(data);
    renderPagination(data);

    // Populate path and prompt type dropdowns on first load from dedicated APIs
    if (!window._filtersLoaded) {
      const [pathsRes, ptRes] = await Promise.all([
        fetch('/admin/api/paths'),
        fetch('/admin/api/prompt-types'),
      ]);
      const paths = await pathsRes.json();
      const types = await ptRes.json();

      const currentPath = document.getElementById('filter-path').value;
      document.getElementById('filter-path').innerHTML = '<option value="">All Paths</option>' +
        paths.map(p => '<option value="' + p + '">' + p + '</option>').join('');
      document.getElementById('filter-path').value = currentPath;

      const currentPt2 = document.getElementById('filter-prompt-type').value;
      document.getElementById('filter-prompt-type').innerHTML = '<option value="">All Types</option>' +
        types.map(t => '<option value="' + t + '">' + t + '</option>').join('');
      document.getElementById('filter-prompt-type').value = currentPt2;

      window._filtersLoaded = true;
    }
  } catch (err) {
    document.getElementById('log-table').innerHTML =
      '<tr><td colspan="7" class="empty-state">Error loading data: ' + err.message + '</td></tr>';
  }
}

function renderLogs(data) {
  const tbody = document.getElementById('log-table');
  if (data.logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No logs found</td></tr>';
    return;
  }
  tbody.innerHTML = data.logs.map(log => {
    const pt = log.prompt_type;
    const ptBadge = pt ? '<span class="pt-badge ' + getPtBadgeClass(pt) + '">' + getPtLabel(pt) + '</span>' : '<span style="color:#8b949e">-</span>';
    return '<tr onclick="showDetail(' + JSON.stringify(log.id).replace(/"/g, '&quot;') + ')">' +
      '<td>' + formatDate(log.timestamp) + '</td>' +
      '<td>' + (log.model || '-') + '</td>' +
      '<td>' + ptBadge + '</td>' +
      '<td><span class="path">' + log.path + '</span></td>' +
      '<td class="' + statusClass(log.status_code) + '">' + (log.status_code || '-') + '</td>' +
      '<td>' + formatDuration(log.duration_ms) + '</td>' +
      '<td class="tokens">' + formatTokens(log.prompt_tokens, log.completion_tokens) + '</td>' +
      '</tr>';
  }).join('');
}

function renderPagination(data) {
  const container = document.getElementById('pagination');
  if (data.pages <= 1) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML =
    '<button ' + (data.page <= 1 ? 'disabled' : '') + ' onclick="goToPage(' + (data.page - 1) + ')">&larr; Prev</button>' +
    '<span class="page-info">Page ' + data.page + ' of ' + data.pages + ' (' + data.total + ' total)</span>' +
    '<button ' + (data.page >= data.pages ? 'disabled' : '') + ' onclick="goToPage(' + (data.page + 1) + ')">Next &rarr;</button>';
}

function goToPage(page) {
  currentPage = page;
  updateUrl();
  loadData();
}

function applyFilters() {
  currentPage = 1;
  currentFilters = buildFilterObject();
  updateUrl();
  loadData();
}

function resetFilters() {
  document.getElementById('filter-model').value = '';
  document.getElementById('filter-path').value = '';
  document.getElementById('filter-prompt-type').value = '';
  document.getElementById('filter-start').value = '';
  document.getElementById('filter-end').value = '';
  currentFilters = {};
  currentPage = 1;
  updateUrl();
  loadData();
}

async function showDetail(id) {
  currentLogId = id;
  try {
    const res = await fetch('/admin/api/logs/' + id);
    const data = await res.json();
    currentLogData = data.log;

    const pt = data.log.prompt_type;
    const ptLabel = pt ? '[' + pt + '] ' : '';
    document.getElementById('modal-title').textContent = ptLabel + data.log.path + ' - ' + formatDate(data.log.timestamp);
    document.getElementById('modal-body').innerHTML = renderModalContent(data.log);
    document.getElementById('modal').classList.add('active');
    updateHash();
  } catch (err) {
    alert('Error loading log details: ' + err.message);
  }
}

function closeModal() {
  document.getElementById('modal').classList.remove('active');
  currentLogId = null;
  currentLogData = null;
  updateHash();
}

function closeModalOnOverlay(e) {
  if (e.target === e.currentTarget) closeModal();
}

// Close modal on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// --- Initialization ---

// Read URL params first (but don't apply yet - dropdowns are empty)
const urlParams = readUrlParams();

// Load data once to populate dropdowns, then apply URL params
loadData().then(() => {
  applyUrlParamsToDropdowns(urlParams);
  currentFilters = buildFilterObject();

  // If URL had filters, re-fetch with them applied
  const hasFilters = Object.keys(currentFilters).length > 0 || currentPage !== 1;
  if (hasFilters) {
    loadData();
  }

  // Check hash for log ID to open
  const hashLogId = readHash();
  if (hashLogId) showDetail(hashLogId);
});

// Auto-refresh every 30 seconds
setInterval(() => {
  if (!currentLogId) loadData();
}, 30000);
