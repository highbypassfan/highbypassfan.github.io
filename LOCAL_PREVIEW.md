# Local Preview

For this site, the simplest preview is opening the homepage directly in your browser.

From the repo folder, either:

```powershell
.\open-local-preview.bat
```

or open `index.html` manually in Chrome.

Then refresh the page after you edit a file to see changes.

Notes:

- The homepage now uses relative links for the real internal pages, so local preview stays on your local files.
- Placeholder links that still point at `example.com` will still leave the site until we replace them.
- A PowerShell server script is also included in `start-local-preview.ps1`, but opening the file directly is the more reliable option on this machine right now.
