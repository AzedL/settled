# Many Tags Overflow Probe

This item carries 21 tags (including one intentionally long kebab-case tag) to stress-test all three tag UI surfaces:

1. **Sidebar tag filter bar**: bounded height (`88px`) with vertical scroll and single-pill ellipsis truncation.
2. **Sidebar item card**: caps visible pills and collapses extras into `+N` with full list on hover.
3. **Detail metadata card**: `1/3` grid cell stays strictly within column bounds (`min-w-0`) and scrolls cleanly when crowded.

Compare inline command styling here (`echo many-tags-probe-ok`) against the expanded log command line below.
