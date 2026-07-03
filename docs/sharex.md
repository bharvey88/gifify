# ShareX integration

If you record with [ShareX](https://getsharex.com/), gifify can pick up right
where the recording stops. Two custom uploaders live in [`../sharex/`](../sharex/):

- **gifify (open editor)** — the recording lands in gifify's trim editor in a
  new browser tab, ready to trim, crop, and convert.
- **gifify (auto WebP)** — converts immediately with the Wiki WebP preset and
  puts the output file path on your clipboard. No trimming, zero clicks.

## Setup

1. Double-click **`sharex\install.cmd`** inside your cloned gifify folder and
   accept ShareX's two import prompts. (The `.sxcu` files are on your disk
   already, no downloading; `install.cmd` just opens both for you.)
2. In ShareX: **Destinations → File uploader → Custom file uploader**. The
   gifify entries never appear in that menu by name; custom uploaders live one
   level deeper.
3. **Destinations → Custom uploader settings...**: both gifify entries show in
   the list. In the bottom-left dropdowns, set **File uploader** to the one you
   want (the other dropdowns don't matter for recordings).
4. Attach the upload step to your screen-recording hotkey only: open
   **Hotkey settings...**, click the **gear icon** on your screen recording
   hotkey, enable **Override after capture tasks**, and check
   **Upload image to host** inside the override.

**Do not** enable **Upload image to host** globally under
**After capture tasks**. That task applies to every capture, so your
screenshots would start uploading to whatever your Image uploader destination
is (Imgur by default). The per-hotkey override above uploads recordings only.

## Recording

Record with plain **Screen recording** (MP4), not **Screen recording (GIF)**.
The MP4 is the full-quality source; gifify does the GIF/WebP conversion
properly from it, with two-pass palette generation. ShareX's GIF mode would
throw away color depth first and hand gifify a worse, bigger input.

gifify has to be running (tray icon or `npm start`) when the recording
finishes, or ShareX will report a connection error.

## Gotchas

- **"Task completed" but nothing in gifify:** the recording hotkey is missing
  **Upload image to host** (setup step 4). Without it, ShareX saves the file
  and stops, so "completed" just means "saved to disk". Confirm in ShareX's
  **History**: an entry with a file path but an empty URL column never
  attempted an upload.
- **Override ignored:** the override only applies when the recording starts
  from that hotkey, or from the tray menu's **Workflows** section (which
  carries hotkey settings). Starting a recording from
  **Capture → Screen recording** in the menu uses the global task settings
  and won't upload.
- **The Test button fails:** don't use **Test** in the Custom uploader
  settings window; ShareX tests with a fake non-video file, which gifify
  correctly rejects. Test by recording a short screen recording instead.
