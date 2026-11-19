const statusEl = document.getElementById('status');
const liveStatusEl = document.getElementById('live-status');
const formEl = document.getElementById('studio-form');
const planTypeEl = document.getElementById('plan-type');
const templateEl = document.getElementById('template');
const pageEl = document.getElementById('page');
const sourceEl = document.getElementById('source');
const fixtureEl = document.getElementById('fixture');
const fixtureField = document.getElementById('fixture-field');
const planField = document.getElementById('plan-field');
const planIdEl = document.getElementById('plan-id');
const tokenField = document.getElementById('token-field');
const jwtEl = document.getElementById('jwt');
const formatEl = document.getElementById('format');
const previewBtn = document.getElementById('preview-btn');
const metaEl = document.getElementById('meta');
const metaListEl = document.getElementById('meta-list');
const previewEl = document.getElementById('preview');
const previewStatusEl = document.getElementById('preview-status');
const previewHtmlFrame = document.getElementById('preview-frame-html');
const previewPdfFrame = document.getElementById('preview-frame-pdf');

/** In-memory JWT only — never written to storage or URLs / SSE. */
let jwtToken = '';

/** @type {{ planTypes: string[], templates: object[], fixtures: object[] }} */
let catalog = { planTypes: [], templates: [], fixtures: [] };

/** @type {string|null} */
let previewObjectUrl = null;

/** Last successful preview request context for auto-refresh. */
let lastPreviewContext = null;
let previewInFlight = false;
let reloadRefreshTimer = null;
/** @type {EventSource|null} */
let eventSource = null;

const setStatus = (message, isError = false) => {
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', isError);
};

const setLiveStatus = (message, { live = false, error = false } = {}) => {
    liveStatusEl.textContent = message;
    liveStatusEl.classList.toggle('is-live', live && !error);
    liveStatusEl.classList.toggle('is-error', error);
};

const setPreviewStatus = (message, isError = false) => {
    previewStatusEl.textContent = message;
    previewStatusEl.classList.toggle('is-error', isError);
};

const clearElement = (el) => {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
};

const fillSelect = (select, options, selectedValue) => {
    clearElement(select);
    for (const option of options) {
        const el = document.createElement('option');
        el.value = option.value;
        el.textContent = option.label;
        select.appendChild(el);
    }
    if (selectedValue && options.some((o) => o.value === selectedValue)) {
        select.value = selectedValue;
    } else if (options[0]) {
        select.value = options[0].value;
    }
};

const templatesForPlanType = (planType) =>
    catalog.templates.filter((entry) => entry.planType === planType);

const fixturesForPlanType = (planType) =>
    catalog.fixtures.filter((entry) => entry.planType === planType);

const selectedTemplate = () => {
    const planType = planTypeEl.value;
    const templateId = templateEl.value;
    return (
        catalog.templates.find(
            (entry) => entry.planType === planType && entry.templateId === templateId
        ) ?? null
    );
};

const appendMetaRow = (label, value) => {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    row.appendChild(dt);
    row.appendChild(dd);
    metaListEl.appendChild(row);
};

const revokePreviewUrl = () => {
    if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
    }
};

const renderMeta = () => {
    const entry = selectedTemplate();
    const pageId = pageEl.value;
    clearElement(metaListEl);

    if (!entry) {
        metaEl.hidden = true;
        return;
    }

    const page = entry.pages.find((p) => p.id === pageId) ?? null;
    appendMetaRow('Plan type', entry.planType);
    appendMetaRow('Template', `${entry.name} (${entry.templateId})`);
    appendMetaRow(
        'Page',
        page ? `${page.label} (${page.id})` : pageId || '—'
    );
    appendMetaRow('Source', sourceEl.value);
    appendMetaRow('Format', formatEl.value);
    appendMetaRow('Phase', 'C — live reload');
    metaEl.hidden = false;
};

const syncSourceFields = () => {
    const isFixture = sourceEl.value === 'fixture';
    fixtureField.hidden = !isFixture;
    planField.hidden = isFixture;
    tokenField.hidden = isFixture;
    fixtureEl.disabled = !isFixture;
    planIdEl.disabled = isFixture;
    jwtEl.disabled = isFixture;
};

const refreshFixtures = () => {
    const planType = planTypeEl.value;
    const fixtures = fixturesForPlanType(planType);
    fillSelect(
        fixtureEl,
        fixtures.map((entry) => ({
            value: entry.id,
            label: `${entry.label} (${entry.id})`,
        }))
    );
    fixtureEl.disabled = fixtures.length === 0 || sourceEl.value !== 'fixture';
};

const refreshPages = () => {
    const entry = selectedTemplate();
    const pages = entry?.pages ?? [];
    fillSelect(
        pageEl,
        pages.map((page) => ({
            value: page.id,
            label: page.label,
        })),
        entry?.defaultPageId
    );
    pageEl.disabled = pages.length === 0;
    renderMeta();
};

const refreshTemplates = () => {
    const planType = planTypeEl.value;
    const entries = templatesForPlanType(planType);
    fillSelect(
        templateEl,
        entries.map((entry) => ({
            value: entry.templateId,
            label: `${entry.name} (${entry.templateId})`,
        }))
    );
    templateEl.disabled = entries.length === 0;

    refreshFixtures();

    if (!entries.length) {
        fillSelect(pageEl, []);
        pageEl.disabled = true;
        metaEl.hidden = true;
        setStatus(`No Studio templates registered for plan type “${planType}”.`);
        return;
    }

    setStatus('Configure source and click Preview.');
    refreshPages();
};

const buildPreviewBody = () => {
    const body = {
        planType: planTypeEl.value,
        source: sourceEl.value,
        templateId: templateEl.value,
        pageId: pageEl.value,
        format: formatEl.value,
    };

    if (body.source === 'fixture') {
        body.fixtureId = fixtureEl.value;
    } else {
        body.planId = planIdEl.value.trim();
    }
    return body;
};

/**
 * @param {{ clearOnFailure?: boolean, auto?: boolean }} [opts]
 */
const runPreview = async (opts = {}) => {
    const { clearOnFailure = true, auto = false } = opts;

    if (previewInFlight) return;
    if (auto && sourceEl.value === 'plan' && !jwtEl.value.trim()) {
        setPreviewStatus(
            'Live reload skipped: real-plan preview needs a JWT.',
            true
        );
        return;
    }

    previewEl.hidden = false;
    setPreviewStatus(auto ? 'Live reload: refreshing preview…' : 'Generating preview…');
    previewBtn.disabled = true;
    previewInFlight = true;

    jwtToken = jwtEl.value.trim();
    const body = buildPreviewBody();

    const headers = {
        'Content-Type': 'application/json',
        Accept: body.format === 'pdf' ? 'application/pdf' : 'text/html',
    };
    if (body.source === 'plan' && jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`;
    }

    try {
        const res = await fetch('/api/studio/preview', {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errJson = await res.json().catch(() => ({}));
            throw new Error(errJson?.message || `Preview failed (${res.status})`);
        }

        if (body.format === 'html') {
            const html = await res.text();
            previewPdfFrame.hidden = true;
            previewPdfFrame.removeAttribute('src');
            previewHtmlFrame.hidden = false;
            previewHtmlFrame.removeAttribute('src');
            previewHtmlFrame.srcdoc = html;
            setPreviewStatus(
                auto ? 'Live reload: HTML preview updated.' : 'HTML preview ready.'
            );
        } else {
            const buffer = await res.arrayBuffer();
            revokePreviewUrl();
            previewObjectUrl = URL.createObjectURL(
                new Blob([buffer], { type: 'application/pdf' })
            );
            previewHtmlFrame.hidden = true;
            previewHtmlFrame.removeAttribute('srcdoc');
            previewPdfFrame.hidden = false;
            previewPdfFrame.src = previewObjectUrl;
            setPreviewStatus(
                auto ? 'Live reload: PDF preview updated.' : 'PDF preview ready.'
            );
        }

        lastPreviewContext = {
            templateId: body.templateId,
            planType: body.planType,
            pageId: body.pageId,
            source: body.source,
            format: body.format,
        };
    } catch (err) {
        if (clearOnFailure && !auto) {
            previewHtmlFrame.hidden = true;
            previewPdfFrame.hidden = true;
            revokePreviewUrl();
            previewHtmlFrame.removeAttribute('srcdoc');
            previewPdfFrame.removeAttribute('src');
        }
        setPreviewStatus(err?.message || 'Preview failed.', true);
    } finally {
        previewInFlight = false;
        previewBtn.disabled = false;
        renderMeta();
    }
};

const scheduleLiveRefresh = (templateId) => {
    if (!lastPreviewContext) return;
    if (templateId && templateId !== lastPreviewContext.templateId) return;
    if (templateId && templateId !== templateEl.value) return;

    if (reloadRefreshTimer) clearTimeout(reloadRefreshTimer);
    reloadRefreshTimer = setTimeout(() => {
        reloadRefreshTimer = null;
        runPreview({ clearOnFailure: false, auto: true });
    }, 150);
};

const connectLiveReload = () => {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }

    setLiveStatus('Live reload: connecting…');
    const source = new EventSource('/api/studio/events');
    eventSource = source;

    source.addEventListener('studio', (event) => {
        let payload = null;
        try {
            payload = JSON.parse(event.data);
        } catch {
            return;
        }

        if (!payload || typeof payload !== 'object') return;

        if (payload.type === 'ready') {
            setLiveStatus('Live reload: connected', { live: true });
            return;
        }

        if (payload.type === 'error') {
            setLiveStatus(
                `Live reload error${payload.templateId ? ` (${payload.templateId})` : ''}: ${payload.message || 'unknown'}`,
                { error: true }
            );
            return;
        }

        if (payload.type === 'module') {
            setLiveStatus(
                `Template module reloaded: ${payload.templateId || 'unknown'}`,
                { live: true }
            );
            scheduleLiveRefresh(payload.templateId);
            return;
        }

        if (payload.type === 'assets') {
            setLiveStatus(
                `Assets refreshed: ${payload.templateId || 'unknown'}`,
                { live: true }
            );
            scheduleLiveRefresh(payload.templateId);
        }
    });

    source.onopen = () => {
        setLiveStatus('Live reload: connected', { live: true });
    };

    source.onerror = () => {
        setLiveStatus('Live reload: disconnected — retrying…', { error: true });
    };
};

const bootstrap = async () => {
    try {
        const [templatesRes, fixturesRes] = await Promise.all([
            fetch('/api/studio/templates'),
            fetch('/api/studio/fixtures'),
        ]);
        const templatesJson = await templatesRes.json().catch(() => ({}));
        const fixturesJson = await fixturesRes.json().catch(() => ({}));

        if (!templatesRes.ok || !templatesJson?.success) {
            throw new Error(
                templatesJson?.message || `Templates failed (${templatesRes.status})`
            );
        }
        if (!fixturesRes.ok || !fixturesJson?.success) {
            throw new Error(
                fixturesJson?.message || `Fixtures failed (${fixturesRes.status})`
            );
        }

        catalog = {
            planTypes: templatesJson.data?.planTypes ?? [],
            templates: templatesJson.data?.templates ?? [],
            fixtures: fixturesJson.data?.fixtures ?? [],
        };

        if (!catalog.planTypes.length) {
            setStatus('No plan types are available in the Studio registry.', true);
            return;
        }

        fillSelect(
            planTypeEl,
            catalog.planTypes.map((type) => ({
                value: type,
                label: type,
            })),
            catalog.planTypes.includes('workout') ? 'workout' : catalog.planTypes[0]
        );

        formEl.hidden = false;
        syncSourceFields();
        refreshTemplates();
        connectLiveReload();
    } catch (err) {
        setStatus(err?.message || 'Failed to load Studio catalog.', true);
        formEl.hidden = true;
        metaEl.hidden = true;
    }
};

planTypeEl.addEventListener('change', refreshTemplates);
templateEl.addEventListener('change', refreshPages);
pageEl.addEventListener('change', renderMeta);
sourceEl.addEventListener('change', () => {
    syncSourceFields();
    renderMeta();
});
formatEl.addEventListener('change', renderMeta);
formEl.addEventListener('submit', (event) => {
    event.preventDefault();
    runPreview({ clearOnFailure: true, auto: false });
});

jwtEl.addEventListener('input', () => {
    jwtToken = jwtEl.value;
});

bootstrap();
