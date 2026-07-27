---
layout: ../../../layouts/DocsLayout.astro
title: Watchlist
---

# Watchlist

A running price board for the symbols you follow, grouped into lists.

```
┌ Watchlist ▾ ─────────────────── ✕ ┐   ← title is a dropdown: switch / create / rename / remove
│  ＋   ＋☰                      ⋯  │   ← add symbol · add section · customize columns
├───────────────────────────────────┤
│ SYMBOL      LAST   CHG   CHG%     │   ← click to sort, drag to reorder
│ EP          7609  +57  +0.75%     │
│ ENQ        29890  -12  -0.04%     │
└───────────────────────────────────┘
```

Open it from the right rail.

## Lists

The title is a dropdown. It holds as many lists as you want.

- **Switch** — the active list is highlighted.
- **Create** — type a name in *New list…* and press Enter.
- **Rename** — the pencil on a row.
- **Remove** — the ✕ on a row, confirmed first.

All lists persist across sessions. Each keeps its own symbols, sections, and order.

## Symbols and sections

- **Add symbol** (`＋`) — symbol search adds the pick to the current list.
- **Add section** (`＋☰`) — a header that groups the symbols under it. Double-click to rename, twirl to collapse.
- **Remove** — the ✕ on a row. Removing a section keeps its symbols.

Symbols above the first header are uncategorized.

## Rearranging

- **Rows** — drag a symbol up or down. A section header carries its symbols with it.
- **Columns** — drag a column header left or right. Symbol stays pinned first.

## Columns

The `⋯` button opens **Customize columns** — a checklist that shows or hides each value column.

The choice and the column order apply to every list, and persist. Columns are a global setting, not per-list.

## Sorting is display-only

Click a column header to sort.

- First click descending, second ascending, third back to manual order.
- Symbol sorts by name; value columns sort by number.
- Sorting stays within each section — headers hold their place.

Sorting never changes your saved order. Turn it off and manual row-drag resumes.

## The values

| Column | Meaning |
| --- | --- |
| Last | Last traded price |
| Change | Last − prior session close |
| Change % | The change as a percent of the prior close |
| Bid | Best bid |
| Ask | Best ask |
| Spread | Ask − Bid |

Last, Change, and Change % are on by default. Bid, Ask, and Spread are off — enable them in Customize columns.

Each row carries its symbol and broker. A symbol only means something with the broker it trades on.

## Layout

Drag the left edge to resize. The width is remembered per panel.

Click a row to load that symbol on the active chart.
