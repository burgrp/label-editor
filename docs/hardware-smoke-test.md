# PT-P300BT hardware smoke test

Run this checklist in Chrome or Edge from `localhost` or the HTTPS deployment.
Use a short starter document to avoid wasting tape while validating a release.

## Connection and media

1. Pair the PT-P300BT in the operating system's Bluetooth settings.
2. Load a known tape cassette, close the cover, and switch the printer on.
3. Open the application and select that tape width for the offline preview.
4. Press **Connect printer** and choose the paired SPP device.
5. Confirm that the connected model and media width are shown.
6. Confirm that the preview width changes if the detected media differs from
   the offline selection.

## Selected label

1. Use a single record with a border, text near each edge, and an asymmetric
   mark that makes orientation obvious.
2. Confirm that the preview is legible and fully inside the tape boundary.
3. Press **Print current**.
4. Confirm progress reaches completion and the UI becomes interactive again.
5. Manually cut the tape.
6. Compare content, orientation, centering, margins, and clipping to preview.

## Continuous strip

1. Add three visibly different CSV records.
2. Choose **Strip** in the preview header and confirm all three segments appear
   in order.
3. Press **Print strip**.
4. Confirm the printer feeds one uninterrupted strip, with no cut command or
   unintended gap between records.
5. Manually cut once after the third segment.

## Error handling

Repeat a short print while checking each condition:

- Cover open before printing.
- No tape cassette.
- Printer switched off or moved out of range after connection.
- Serial permission denied.
- Bluetooth disconnected during transfer.
- Low battery, if practical.

Each condition must produce a visible, actionable failure. It must not report a
successful print, and the application must allow reconnecting afterward.

## Media matrix

If available, repeat the selected-label test with 3.5, 6, 9, and 12 mm tape.
Check that content is centered on the physical tape and that the media reported
by the printer matches the cassette.

Record the browser version, operating system, tape width, and any mismatch when
reporting a hardware issue.
