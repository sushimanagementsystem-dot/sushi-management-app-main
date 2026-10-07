# UI Development Rules

These rules apply to every UI/design task in this repository (`frontend-next` and `frontend`
alike), from now on.

## Responsive UI Rule (mandatory)

- Every UI change must be implemented for **BOTH desktop and mobile**.
- Never consider a UI task complete after checking only desktop.
- Any component, page, modal, form, card, table, navigation, layout, spacing, typography,
  buttons, inputs, or responsive behavior that is modified must be tested at both desktop and
  mobile breakpoints.
- Desktop and mobile should both look intentional and polished. Do not simply shrink the desktop
  layout for mobile.
- If a desktop layout uses horizontal/side-by-side elements, decide how they should properly
  stack or adapt on smaller screens.
- Prevent horizontal overflow, clipped content, overlapping elements, broken spacing, and
  elements going outside the viewport.
- Check touch targets, input widths, button sizes, text wrapping, scrolling, and vertical spacing
  on mobile.
- Preserve the existing desktop design while making the necessary responsive adjustments.
- Before declaring a UI task complete, visually verify the result at minimum:
  1. Desktop viewport
  2. Mobile viewport
- If a change looks correct on desktop but breaks on mobile, the task is NOT complete. Fix the
  mobile layout before reporting completion.

## Workflow

1. First inspect the existing component/page and understand its current responsive behavior.
2. Make the requested UI change.
3. Check desktop.
4. Check mobile.
5. Fix any responsive issues found.
6. Re-check desktop after mobile changes to make sure nothing was broken.
7. Only then report the task as completed.

For every future UI task, treat "responsive on desktop + mobile" as part of the acceptance
criteria automatically, even if not explicitly mentioned in the request.
