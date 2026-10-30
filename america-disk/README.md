# America's Disk Is Full

A disk-cleanup game for the FY2026 US federal budget. Open `index.html` in any browser (double-click works, no server needed).

- `index.html` — the whole game, with the budget data built in.
- `data.json` — the same data on its own: a nested tree of `[name, $millions, children, flags, accounts]`.
  Flags: 1 = locked, 2 = named recipient, 4 = other award recipients, 8 = not tied to a named recipient.

## Sources
- Outlays and receipts: U.S. Treasury Monthly Treasury Statement, September 2026 (FY2026 year to date), Tables 4 and 5. https://fiscaldata.treasury.gov/datasets/monthly-treasury-statement/
- Recipients: USAspending.gov API, FY2026 award obligations by federal account, scaled to each account's Treasury outlays (estimates). https://api.usaspending.gov/

Inspired by Britain's Disk Is Full (https://britains-disk.pages.dev/). Your plan is saved in your browser only.
