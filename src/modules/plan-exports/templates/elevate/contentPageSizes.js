/**
 * Content-based PDF page boxes for Elevate Workout + Nutrition pages.
 *
 * Covers stay A4. Overview / detail / meals / notes pages are measured after
 * layout and assigned matching CSS named `@page` sizes so Chromium
 * (`preferCSSPageSize`) emits short pages instead of empty A4 space.
 */

/** Design canvas width (matches `.page { width: 794px }`). */
export const ELEVATE_PAGE_WIDTH_PX = 794;

/** Fixed A4 design height for covers (matches `.page { height: 1123px }`). */
export const ELEVATE_A4_HEIGHT_PX = 1123;

/** Minimum content-sized page height so chrome/header never collapse. */
const MIN_CONTENT_PAGE_HEIGHT_PX = 320;

/**
 * Measure rendered Elevate pages and inject named `@page` sizes.
 * Must run after fonts/images settle, before `page.pdf()`.
 *
 * @param {import('playwright-core').Page} page
 */
export const applyElevateContentPageSizes = async (page) => {
    await page.evaluate(
        ({ pageWidth, a4Height, minContentHeight }) => {
            const pages = Array.from(document.querySelectorAll('.page'));
            if (!pages.length) return;

            const isContentSized = (el) =>
                el.classList.contains('page-workout-details') ||
                el.classList.contains('page-workouts') ||
                el.classList.contains('page-nutrition-meals') ||
                el.classList.contains('page-nutrition-notes');

            for (const el of pages) {
                if (!isContentSized(el)) continue;
                el.style.height = 'auto';
                el.style.minHeight = '0';
                el.style.overflow = 'visible';

                if (
                    el.classList.contains('page-workout-details') ||
                    el.classList.contains('page-nutrition-meals') ||
                    el.classList.contains('page-nutrition-notes')
                ) {
                    el.querySelectorAll('.details-stack').forEach((stack) => {
                        stack.style.flex = 'none';
                    });
                    const footer = el.querySelector('.details-footer');
                    if (footer) footer.style.marginTop = '28px';
                }

                if (el.classList.contains('page-workouts')) {
                    const photo = el.querySelector('.workouts-photo');
                    if (photo) {
                        photo.style.marginTop = '12px';
                        photo.style.marginBottom = '0';
                        photo.style.flex = 'none';
                    }
                    const footer = el.querySelector('.workouts-footer');
                    if (footer) footer.style.marginTop = '12px';

                    // Lock Example Week to content height so day cards cannot
                    // stretch when a flex/grid ancestor absorbs leftover page space
                    // (observed in production/serverless Chromium PDF output).
                    const workoutsGrid = el.querySelector('.workouts-grid');
                    if (workoutsGrid) {
                        workoutsGrid.style.flex = 'none';
                        workoutsGrid.style.height = 'auto';
                        workoutsGrid.style.minHeight = '0';
                    }
                    const exampleWeek = el.querySelector('.example-week');
                    if (exampleWeek) {
                        exampleWeek.style.flex = 'none';
                        exampleWeek.style.height = 'auto';
                        exampleWeek.style.minHeight = '0';
                        exampleWeek.style.alignSelf = 'start';
                    }
                    const exampleGrid = el.querySelector('.example-week-grid');
                    if (exampleGrid) {
                        exampleGrid.style.height = 'auto';
                        exampleGrid.style.minHeight = '0';
                        exampleGrid.style.alignItems = 'start';
                        exampleGrid.style.alignContent = 'start';
                        exampleGrid.style.gridAutoRows = 'auto';
                        exampleGrid.style.gridTemplateRows = 'auto';
                    }
                    el.querySelectorAll('.week-day').forEach((day) => {
                        day.style.height = 'auto';
                        day.style.alignSelf = 'start';
                        day.style.flex = 'none';
                    });
                }

                if (el.classList.contains('page-nutrition-notes')) {
                    const bottom = el.querySelector('.notes-bottom');
                    if (bottom) {
                        bottom.style.flex = 'none';
                        bottom.style.marginTop = '14px';
                    }
                }
            }

            void document.body.offsetHeight;

            const rules = [];
            pages.forEach((el, index) => {
                const pageName = `elevate${index}`;
                let heightPx = a4Height;

                if (isContentSized(el)) {
                    const measured = Math.ceil(el.getBoundingClientRect().height);
                    heightPx = Math.max(measured, minContentHeight);
                }

                el.style.height = `${heightPx}px`;
                el.classList.add(`elevate-named-page-${index}`);
                rules.push(
                    `@page ${pageName} { size: ${pageWidth}px ${heightPx}px; margin: 0; }`
                );
                rules.push(`.elevate-named-page-${index} { page: ${pageName}; }`);
            });

            document
                .querySelectorAll('style[data-elevate-content-page-sizes]')
                .forEach((node) => node.remove());

            const style = document.createElement('style');
            style.setAttribute('data-elevate-content-page-sizes', '1');
            style.textContent = rules.join('\n');
            document.head.appendChild(style);
        },
        {
            pageWidth: ELEVATE_PAGE_WIDTH_PX,
            a4Height: ELEVATE_A4_HEIGHT_PX,
            minContentHeight: MIN_CONTENT_PAGE_HEIGHT_PX,
        }
    );
};

/** @deprecated Prefer applyElevateContentPageSizes — kept for existing workout imports. */
export const applyElevateWorkoutContentPageSizes = applyElevateContentPageSizes;

/** Nutrition PDF preparePage alias. */
export const applyElevateNutritionContentPageSizes = applyElevateContentPageSizes;

export default {
    applyElevateContentPageSizes,
    applyElevateWorkoutContentPageSizes,
    applyElevateNutritionContentPageSizes,
    ELEVATE_PAGE_WIDTH_PX,
    ELEVATE_A4_HEIGHT_PX,
};
