/**
 * Plan PDF export — shared constants & template metadata.
 */

export const PLAN_EXPORT_TYPES = Object.freeze(['workout', 'nutrition']);

export const PLAN_EXPORT_TEMPLATE_IDS = Object.freeze(['elevate']);

export const DEFAULT_PLAN_EXPORT_TEMPLATE_ID = 'elevate';

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
