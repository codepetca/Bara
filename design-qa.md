# Design QA: Full-Screen Classroom QR

- Source visual truth: `/tmp/bara-qr-audit-01-display.png`
- Implementation screenshot: `/tmp/bara-qr-implementation-matched.png`
- Side-by-side comparison: `/tmp/bara-qr-before-after.png`
- Browser-rendered visual snapshots:
  - `tests/visual/design-guidance.spec.ts-snapshots/display-desktop-chromium-darwin.png`
  - `tests/visual/design-guidance.spec.ts-snapshots/display-mobile-chromium-darwin.png`
  - `tests/visual/design-guidance.spec.ts-snapshots/display-closed-desktop-chromium-darwin.png`
- Comparison viewport: 1910 × 1074 CSS px at device pixel ratio 0.67
- Source and implementation pixels: 2851 × 1603 each; no density normalization required
- State: open classroom display, with closed and mobile sibling states checked separately

## Findings

No actionable P0, P1, or P2 findings remain.

- Fonts and typography: the existing Sora heading and Geist supporting UI are preserved. The title and count remain readable without competing with the QR.
- Spacing and layout rhythm: the QR stage is square, centered, and limited by the smaller viewport dimension. The measured 946.6 px stage contains a 742 px QR with a four-module quiet zone and no viewport overflow.
- Colors and visual tokens: the existing white/slate open treatment and amber closed treatment are preserved.
- Image quality and asset fidelity: the QR remains vector SVG and renders sharply at the larger size. No raster or decorative image assets are involved.
- Copy and content: the roster title, attendance count, closed status, and inactive-code message are preserved. The closed message is enlarged for across-room readability.
- Accessibility and robustness: the SVG is labeled as an image, the square aspect ratio holds at desktop and mobile widths, and the open and closed states remain visually distinct.

Focused-region comparison was unnecessary because the QR geometry and header are fully legible in the matched full-view comparison. Browser console errors checked: none. The display is passive, so there are no primary interactions to exercise.

## Comparison History

1. First implementation pass: percentage padding resolved against the wide containing block, shrinking the QR below the intended size. Fixed by using a square stage with a proportional `10.81%` inset, which measures as a four-module quiet zone.
2. Closed-state pass: the count below the square created 43 px of vertical overflow. Fixed by moving the count beside the closed-status label in the header; the revised state has zero overflow.
3. Propagation pass: the original closed icon and message were too small inside the enlarged stage. Fixed with responsive distance-readable icon and copy sizing. Desktop open, desktop closed, and mobile open snapshots pass.

## Follow-up Polish

- P3: verify the projected result with representative student phones from the back of the actual classroom; camera optics, projector focus, glare, and room lighting cannot be established in browser QA.

final result: passed
