/**
 * Plan PDF export — shared constants & template metadata.
 */

export const PLAN_EXPORT_TYPES = Object.freeze(['workout', 'nutrition']);

export const PLAN_EXPORT_TEMPLATE_IDS = Object.freeze(['classic', 'elevate']);

export const DEFAULT_PLAN_EXPORT_TEMPLATE_ID = 'classic';

export const PLAN_EXPORT_MIME = 'application/pdf';

/**
 * Code-defined template registry metadata (no DB collection in V1).
 * Each template lists which plan types it supports.
 *
 * `assets.<planType>.previewImageUrl` is modal thumbnail metadata only.
 * It is not rendered into the PDF. PDF-embedded images (if added later)
 * should use an explicit name such as `headerImageUrl`.
 *
 * Add a template by appending here + registering renderers in templates/index.js.
 */
export const PLAN_EXPORT_TEMPLATES = Object.freeze([
    {
        id: 'classic',
        name: 'Classic',
        description: 'Clean professional layout for client-facing plan documents.',
        supportedPlanTypes: Object.freeze(['workout', 'nutrition']),
        assets: Object.freeze({
            nutrition: Object.freeze({
                previewImageUrl:
                    'https://ucarecdn.com/f0c1a1f5-f68f-4050-872e-d605f1df39ee/-/preview/717x856/',
            }),
            workout: Object.freeze({
                previewImageUrl:
                    'https://ucarecdn.com/c4fdab05-2c4e-46cb-b196-b375c3af8f69/-/preview/720x852/',
            }),
        }),
    },
    {
        id: 'elevate',
        name: 'Elevate',
        description:
            'A modern, bold plan template with a premium athletic design.',
        supportedPlanTypes: Object.freeze(['workout', 'nutrition']),
        assets: Object.freeze({
            workout: Object.freeze({
                // Modal thumbnail only — not rendered into the PDF.
                previewImageUrl:
                    'https://ik.imagekit.io/6nagrfhcm/template-cover.png',
            }),
            nutrition: Object.freeze({
                // Modal thumbnail only — not rendered into the PDF.
                previewImageUrl:
                    'https://ik.imagekit.io/6nagrfhcm/fitly-nutrition-plan-p1%202.png',
            }),
        }),
    },
]);
