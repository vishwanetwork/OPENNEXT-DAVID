# Landing and authentication integration

The approved cinematic homepage now lives in `features/site` and is rendered by
the existing `(site)/page.tsx`. It ships with the redesigned Buyer Terminal in the
same Next.js application. The separate Vite/Sites preview is a design reference;
the production change does not depend on that preview or a localhost URL.

## Destinations

All Open Terminal and Buy capacity buttons, including mobile navigation and the
expanded Market image, use `useApp().crossHref` with the existing `workspacePath`
helper. Find capacity, Explore capacity and Enter the Terminal use the same Buyer
destination. Links navigate in the current tab and carry no demo fixture IDs.

| Environment                        | Buyer destination                                   |
| ---------------------------------- | --------------------------------------------------- |
| Configured public website          | `https://terminal.opennextlab.ai/market?role=buyer` |
| Local or unconfigured staging host | `/terminal/market?role=buyer` on the same host      |

The existing host resolver and API proxy are unchanged. An anonymous visitor sees
AuthView at the Buyer destination. A verified, onboarded Buyer sees the market;
an account requiring setup sees the existing onboarding gate. Switching sign-in
and sign-up preserves role, listing and other existing query parameters. Invalid
empty verification responses stay at the login gate. Arbitrary external `next`
parameters are not used as redirects. Existing OAuth callbacks still pass through
LegacyHashRedirect. Back to OpenNEXT and sign-out return through `crossHref('site')`
to the new homepage.

Seller remains visible and disabled in the redesigned Terminal and onboarding.
The homepage retains its approved two-sided narrative and supplier links.

## Preserved design and behavior

- Selected E logo, Manrope, blue-hour imagery and deck-based narrative.
- Scroll-linked hero, buyer-only current Market screenshot, GPU routing animation,
  rolling team metrics and closing photo transition.
- Right-to-left capacity cards and synchronized, bounded rolling-price animation.
  Capacity card values are supplied presentation examples, not live inventory or
  a quote feed; Buy capacity opens the real market without executing a purchase.
- Hover, focus, reduced-motion and hidden-page behavior remain supported. All new
  CSS is scoped to `.opennext-landing`, with separate animation names, so it does
  not restyle the Terminal. Assets are bundled locally; no new package is needed.

The old LandingPage export remains available for its existing behavior tests;
the public route renders only CinematicLandingPage. Shared NativeDialog owns the
image preview's Escape, focus restoration and scroll locking.

## Upstream integration

The PR incorporates main through `f086fa5` and preserves its AsyncButton feedback,
instance loading/error/refresh states, visible-instance usage fetching, Autopilot
prefetch/cache and removal of cross-identity workspace placeholder data. No
deployment workflow, backend wire format or payment/provisioning integration is
replaced by the redesign.

## Verification scope

Focused tests cover production and staging CTA URLs, mobile/menu/modal links,
bounded prices and digit carry/borrow, anonymous authentication gates, email
verification, onboarding, current sessions, logout and query preservation.
Browser checks cover the actual homepage-to-login navigation and return path.
The authenticated Buyer UI is reviewed against the existing isolated local backend;
no production email, OAuth authorization, payment or GPU provisioning is submitted.
Final full-suite and build results are recorded in `design-qa.md`.

The owner requested deployment with the PR using the existing official domains.
Creating a PR does not publish it; merging to main triggers the repository's
existing deployment workflow.
