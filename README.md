# Recast — submission guide

Recast is a marketplace prototype where everyday creators can license original interviews, pranks and skits to other creators. Buyers use AI to put their identity into the selected host's role. Paid selling is the business model; this demo currently uses free licenses and does not promise earnings.

## See the actual results

Go to **My Library**, choose a finished video, and click **Before & After**. Compare the original with the generated result, then download it. Review the whole scene: the model can change backgrounds and other details.

For cloned dialogue, open **Host voice** below a finished video. New generations prepare a speaker transcript automatically; older results have **Find dialogue**. Review approximate times and speaker labels, select only non-overlapping host lines, then generate a separate dubbed video. Gemini and Seed Audio both run through Comfy Router. Other speakers retain the original audio outside selected intervals. Background audio inside those intervals is replaced; this does not add lip sync. Original videos are preserved.

## Run the source on your computer

Requires Node.js 24 or later and npm. From the repository folder:

Windows: double-click `Start-Recast.cmd` after extracting the source ZIP. macOS/Linux: run `sh start-recast.sh`. These install dependencies, build the app, print an invitation, and start the local server. Keep the terminal open while using the app. Your own Comfy key and public HTTPS media URL are needed for live video generation; browsing and local uploads do not require credits.

Manual setup:

```sh
npm ci
```

Copy `.env.example` to `.env`, then:

```sh
npm run build
npm run invite
npm start
```

Open http://localhost:3000 and register with the single-use invitation printed above. Add your own permission-cleared footage and identity references. Private media, accounts and credentials are not included in the source package.

Put COMFY_API_KEY in the project-root `.env`. That file overrides shell values and the key stays on the server. Video generation additionally requires PUBLIC_MEDIA_BASE_URL pointing to an HTTPS media gateway; see DEPLOYMENT.md. A key is not required for local authentication, uploads or offline tests.

## Models and reproducibility

Video uses Higgsfield Genjutsu through Comfy Router, with the request builder in `server/pipeline.ts` and recipe in `workflows/host-recast.router.json`.

Scripted voice cloning uses `byteplus/seed-audio-1.0-multilingual` through Comfy Router. `server/voices.ts` submits the saved reference as `references[].audio_data` and refers to it as `@Audio1` in `text_prompt`. The recording must be under 30 seconds and 10 MB. Identity's voice studio creates standalone audio; My Library's Host voice tool uses the same model for reviewed dialogue and saves a separate dubbed video. See `workflows/host-dialogue.router.json`.

Both jobs persist queue handles and download finished media. These are Router request recipes, not ComfyUI canvas graphs. The project does not use the Comfy Cloud workflow client.

## Verification and limitations

Run `npm run check`, `npm test`, and `npm run build`. Genjutsu synthesizes video; single-person isolation and unchanged backgrounds are requested, not guaranteed. Speaker isolation and automatic dialogue synchronization are not implemented. Payments are disabled in this prototype.

MIT applies to the application code; source footage, identities, model services and generated media have separate rights and permissions. A public deployment needs a server and persistent disk, not GitHub Pages.

## Social post draft

Recast turns original content into an opportunity for everyday creators. Film an original interview, prank or skit, license it to other creators, and let them make it their own with AI.

See the actual results: My Library → Before & After.

Built with Higgsfield Genjutsu and Comfy Router. Free-license prototype; paid selling is the business model, not live earnings. AI transformations are disclosed and results need review.

#OpenSourceHiggsfield

Attach the demo video and add the GitHub URL after publication. This draft has not been posted to any social account.
