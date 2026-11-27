/**
 * Content-based PDF page boxes for Elevate Workout + Nutrition pages.
 *
 * Covers stay A4. Overview / detail / meals / notes pages are measured after
 * layout and assigned matching CSS named `@page` sizes so Chromium
 * (`preferCSSPageSize`) emits short pages instead of empty A4 space.
 *
 * Production Chromium (serverless / @sparticuz) can stretch CSS Grid / flex
 * tracks to the print fragmentainer during `page.pdf()`. That emptied Example
 * Week day-card content, left a tall empty overview fragment, and let the next
 * page's header/artwork overlap. We therefore:
 * 1) force content-sized overview layout
 * 2) pixel-lock Example Week / day-card heights from measured content
 * 3) then measure and assign page boxes
 */

/** Design canvas width (matches `.page { width: 794px }`). */
export const ELEVATE_PAGE_WIDTH_PX = 794;

/** Fixed A4 design height for covers (matches `.page { height: 1123px }`). */
export const ELEVATE_A4_HEIGHT_PX = 1123;

/** Minimum content-sized page height so chrome/header never collapse. */
const MIN_CONTENT_PAGE_HEIGHT_PX = 320;

/** Soft cap for a single day card — content-based, not plan-specific. */
const MAX_WEEK_DAY_HEIGHT_PX = 160;

/**
 * Measure rendered Elevate pages and inject named `@page` sizes.
 * Must run after fonts/images settle, before `page.pdf()`.
 *
 * @param {import('playwright-core').Page} page
 */
export const applyElevateContentPageSizes = async (page) => {
    await page.evaluate(
        ({ pageWidth, a4Height, minContentHeight, maxWeekDayHeight }) => {
            const pages = Array.from(document.querySelectorAll('.page'));
            if (!pages.length) return;

            const isContentSized = (el) =>
                el.classList.contains('page-workout-details') ||
                el.classList.contains('page-workouts') ||
                el.classList.contains('page-nutrition-meals') ||
                el.classList.contains('page-nutrition-notes');

            const lockPx = (el, heightPx) => {
                const h = `${Math.max(1, Math.ceil(heightPx))}px`;
                el.style.setProperty('height', h, 'important');
                el.style.setProperty('max-height', h, 'important');
                el.style.setProperty('min-height', h, 'important');
                el.style.setProperty('flex-grow', '0', 'important');
                el.style.setProperty('flex-shrink', '0', 'important');
            };

            /**
             * Height of in-flow content (ignores absolute decorations and any
             * flex/fragmentainer stretch below the last visible child).
             * @param {Element} el
             */
            const measureInFlowContentHeight = (el) => {
                const cs = getComputedStyle(el);
                const padBottom = parseFloat(cs.paddingBottom) || 0;
                const pageTop = el.getBoundingClientRect().top;
                const inFlow = [...el.children].filter((child) => {
                    const childCs = getComputedStyle(child);
                    return (
                        childCs.display !== 'none' &&
                        childCs.position !== 'absolute' &&
                        childCs.position !== 'fixed'
                    );
                });
                if (!inFlow.length) {
                    return Math.ceil(el.getBoundingClientRect().height);
                }
                const contentBottom = Math.max(
                    ...inFlow.map((child) => child.getBoundingClientRect().bottom)
                );
                return Math.ceil(contentBottom - pageTop + padBottom);
            };

            /**
             * Reset Example Week to intrinsic sizing, then pixel-lock measured
             * heights so print fragmentainers cannot stretch the cards.
             * @param {Element} pageEl
             */
            const lockExampleWeekContentHeights = (pageEl) => {
                const workoutsGrid = pageEl.querySelector('.workouts-grid');
                if (workoutsGrid) {
                    workoutsGrid.style.setProperty('flex', 'none', 'important');
                    workoutsGrid.style.setProperty('height', 'auto', 'important');
                    workoutsGrid.style.setProperty('min-height', '0', 'important');
                    workoutsGrid.style.setProperty(
                        'max-height',
                        'none',
                        'important'
                    );
                }

                const exampleWeeks = pageEl.querySelectorAll('.example-week');
                exampleWeeks.forEach((exampleWeek) => {
                    exampleWeek.style.setProperty('flex', 'none', 'important');
                    exampleWeek.style.setProperty('height', 'auto', 'important');
                    exampleWeek.style.setProperty('min-height', '0', 'important');
                    exampleWeek.style.setProperty(
                        'max-height',
                        'none',
                        'important'
                    );
                    exampleWeek.style.setProperty(
                        'align-self',
                        'flex-start',
                        'important'
                    );
                    exampleWeek.style.setProperty(
                        'break-inside',
                        'avoid',
                        'important'
                    );
                    exampleWeek.style.setProperty(
                        'page-break-inside',
                        'avoid',
                        'important'
                    );

                    const exampleGrid =
                        exampleWeek.querySelector('.example-week-grid');
                    if (exampleGrid) {
                        // Flex row avoids production Chromium print grid-track
                        // stretch into the fragmentainer.
                        exampleGrid.style.setProperty(
                            'display',
                            'flex',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'flex-direction',
                            'row',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'flex-wrap',
                            'nowrap',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'align-items',
                            'flex-start',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'align-content',
                            'flex-start',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'height',
                            'auto',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'min-height',
                            '0',
                            'important'
                        );
                        exampleGrid.style.setProperty(
                            'max-height',
                            'none',
                            'important'
                        );
                    }

                    const days = [
                        ...exampleWeek.querySelectorAll('.week-day'),
                    ];
                    days.forEach((day) => {
                        day.style.removeProperty('height');
                        day.style.removeProperty('max-height');
                        day.style.removeProperty('min-height');
                        day.style.setProperty('height', 'auto', 'important');
                        day.style.setProperty('max-height', 'none', 'important');
                        day.style.setProperty('min-height', '0', 'important');
                        day.style.setProperty('flex', '1 1 0', 'important');
                        day.style.setProperty(
                            'align-self',
                            'flex-start',
                            'important'
                        );
                        day.style.setProperty('overflow', 'visible', 'important');
                        day.style.setProperty(
                            'break-inside',
                            'avoid',
                            'important'
                        );
                        day.style.setProperty(
                            'page-break-inside',
                            'avoid',
                            'important'
                        );
                    });
                });

                void document.body.offsetHeight;

                exampleWeeks.forEach((exampleWeek) => {
                    const days = [
                        ...exampleWeek.querySelectorAll('.week-day'),
                    ];
                    const dayHeights = days.map((day) => {
                        const rectH = day.getBoundingClientRect().height;
                        const borderY =
                            (parseFloat(getComputedStyle(day).borderTopWidth) ||
                                0) +
                            (parseFloat(
                                getComputedStyle(day).borderBottomWidth
                            ) || 0);
                        return Math.ceil(
                            Math.max(rectH, day.scrollHeight + borderY)
                        );
                    });
                    const targetDayHeight = Math.min(
                        maxWeekDayHeight,
                        Math.max(78, ...dayHeights, 78)
                    );
                    days.forEach((day) => {
                        lockPx(day, targetDayHeight);
                        day.style.setProperty('flex', '1 1 0', 'important');
                        day.style.setProperty(
                            'align-self',
                            'flex-start',
                            'important'
                        );
                    });

                    const exampleGrid =
                        exampleWeek.querySelector('.example-week-grid');
                    if (exampleGrid) {
                        void document.body.offsetHeight;
                        lockPx(
                            exampleGrid,
                            exampleGrid.getBoundingClientRect().height
                        );
                    }

                    void document.body.offsetHeight;
                    lockPx(
                        exampleWeek,
                        exampleWeek.getBoundingClientRect().height
                    );
                });
            };

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
                    const end = el.querySelector('.workouts-end');
                    if (end) {
                        end.style.setProperty('flex', 'none', 'important');
                        end.style.setProperty('break-inside', 'avoid', 'important');
                        end.style.setProperty(
                            'page-break-inside',
                            'avoid',
                            'important'
                        );
                        end.style.setProperty('break-before', 'avoid', 'important');
                        end.style.setProperty(
                            'page-break-before',
                            'avoid',
                            'important'
                        );
                    }
                    const photo = el.querySelector('.workouts-photo');
                    if (photo) {
                        photo.style.flex = 'none';
                        photo.style.marginBottom = '0';
                        // Keep a tight gap after notes when photo is not wrapped.
                        if (!end) photo.style.marginTop = '12px';
                        photo.style.setProperty(
                            'break-inside',
                            'avoid',
                            'important'
                        );
                        photo.style.setProperty(
                            'page-break-inside',
                            'avoid',
                            'important'
                        );
                        photo.style.setProperty(
                            'break-after',
                            'avoid',
                            'important'
                        );
                        photo.style.setProperty(
                            'page-break-after',
                            'avoid',
                            'important'
                        );
                    }
                    const footer = el.querySelector('.workouts-footer');
                    if (footer) {
                        if (!end) footer.style.marginTop = '12px';
                        footer.style.setProperty(
                            'break-inside',
                            'avoid',
                            'important'
                        );
                        footer.style.setProperty(
                            'page-break-inside',
                            'avoid',
                            'important'
                        );
                        footer.style.setProperty(
                            'break-before',
                            'avoid',
                            'important'
                        );
                        footer.style.setProperty(
                            'page-break-before',
                            'avoid',
                            'important'
                        );
                    }
                    lockExampleWeekContentHeights(el);
                }

                if (el.classList.contains('page-nutrition-notes')) {
                    const bottom = el.querySelector('.notes-bottom');
                    if (bottom) {
                        bottom.style.flex = 'none';
                        bottom.style.marginTop = '14px';
                    }
                }
            }

            // Nutrition cover is A4-sized but still needs Example Week locks.
            document
                .querySelectorAll('.page-nutrition-cover')
                .forEach((cover) => {
                    if (cover.querySelector('.example-week')) {
                        lockExampleWeekContentHeights(cover);
                    }
                });

            void document.body.offsetHeight;

            const rules = [];
            pages.forEach((el, index) => {
                const pageName = `elevate${index}`;
                let heightPx = a4Height;

                if (isContentSized(el)) {
                    // Re-assert Example Week locks before measuring the page so
                    // a stretched fragmentainer cannot inflate the page box.
                    if (el.classList.contains('page-workouts')) {
                        lockExampleWeekContentHeights(el);

                        // Pixel-lock the gym photo to its laid-out height so print
                        // cannot grow/shrink it and push it onto the next page.
                        const photo = el.querySelector('.workouts-photo');
                        if (photo) {
                            void document.body.offsetHeight;
                            const photoH = Math.ceil(
                                Math.max(
                                    photo.getBoundingClientRect().height,
                                    96
                                )
                            );
                            lockPx(photo, Math.min(240, photoH));
                            photo.style.setProperty(
                                'object-fit',
                                'cover',
                                'important'
                            );
                        }

                        void document.body.offsetHeight;
                        // Overview: size from last in-flow child (end/footer), not
                        // a stretched page box — includes photo + footer.
                        heightPx = Math.max(
                            measureInFlowContentHeight(el),
                            minContentHeight
                        );
                    } else {
                        const measured = Math.ceil(
                            el.getBoundingClientRect().height
                        );
                        heightPx = Math.max(measured, minContentHeight);
                    }
                }

                if (el.classList.contains('page-workouts')) {
                    // !important so @media print `height: auto` cannot drop the
                    // locked box and leave the named @page taller than content.
                    lockPx(el, heightPx);
                    // Clip overflow so the photo cannot paint onto the next page
                    // if print layout drifts by a few pixels.
                    el.style.setProperty('overflow', 'hidden', 'important');
                    el.style.setProperty('break-inside', 'avoid', 'important');
                    el.style.setProperty(
                        'page-break-inside',
                        'avoid',
                        'important'
                    );
                } else {
                    el.style.height = `${heightPx}px`;
                }
                el.classList.add(`elevate-named-page-${index}`);
                rules.push(
                    `@page ${pageName} { size: ${pageWidth}px ${heightPx}px; margin: 0; }`
                );
                rules.push(
                    `.elevate-named-page-${index} { page: ${pageName}; }`
                );
            });

            // Final pass: page boxes now have definite heights; re-lock Example
            // Week so print layout cannot redistribute leftover free space.
            pages.forEach((el) => {
                if (el.classList.contains('page-workouts')) {
                    lockExampleWeekContentHeights(el);
                }
            });
            document
                .querySelectorAll('.page-nutrition-cover')
                .forEach((cover) => {
                    if (cover.querySelector('.example-week')) {
                        lockExampleWeekContentHeights(cover);
                    }
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
            maxWeekDayHeight: MAX_WEEK_DAY_HEIGHT_PX,
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
