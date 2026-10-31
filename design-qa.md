# Buyer Terminal design QA — iteration 6

final result: passed

## Scope and reference

The user requested removal of visible middle dots and the repeated “Spot” result
label, more space between dropdown arrows and their right borders, and an All
checkbox that actually checks all filter options. This iteration applies those
changes within Buyer Terminal while retaining the original product flows.

- Before: `../qa-v6/before-market.png`.
- Desktop Market: `../qa-v6/market-filters-desktop.png`.
- Mobile Market: `../qa-v6/market-filters-mobile.png`.
- RFQ controls: `../qa-v6/rfq-dropdowns.png`.
- Market Insight: `../qa-v6/insight-desktop.png`.
- Previous thumbnail QA: `../qa-v6/previous-design-qa.md`.
- Review: `http://localhost:5194/terminal/demo/market?role=buyer`.

## Findings and corrections

No actionable P0/P1/P2 issue remains in the reviewed scope.

1. Buyer-facing middle-dot separators are removed from visible copy and the
   CSS-generated legend separator. The Market result label now displays the offer
   count without repeating the active term.
2. Native single-select dropdowns use a consistent chevron inset of 16px and 44px
   right padding. Labels retain their space beside the arrow. Filter disclosures
   align to the same inset; the compact RFQ history selector accommodates its
   longer labels. Native keyboard/touch behavior is retained, with a native-arrow
   fallback for forced-color mode.
3. All and individual filter checkboxes are synchronized. Selecting All selects
   every option in the group, including options outside the current search text.
   Partial selection displays a mixed state. Clearing All leaves every child
   unchecked and produces zero matching results; Reset restores the default
   unrestricted selection. Selecting every child marks All checked.
4. Market Insight's Index model remains independent of the resource table filter
   selection. The control's purpose and the existing backend data flow are retained.
5. Desktop/mobile Market, RFQ dropdowns and Insight evidence cover the updated
   spacing and content. No extra helper labels or decorative text were added.

## Validation

- Formatting passed.
- Lint passed with zero errors and three existing max-lines warnings.
- Typecheck passed.
- Full test run passed 426 tests: 418 web and 8 contracts.
- A regional-history backend-label regression test added after that run passed in
  its focused 12-test suite. Current coverage is 427 tests; the complete suite was
  not rerun after that one test was added.
- Production build passed.

The original APIs, contract package, backend logic, routing and isolated-preview
safeguards are unchanged. No real transactions, live publication or GitHub push
occurred. The source patch and integration bundle are local handoff artifacts.
