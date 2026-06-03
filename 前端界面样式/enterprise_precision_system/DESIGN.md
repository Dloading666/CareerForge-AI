---
name: Enterprise Precision System
colors:
  surface: '#faf8ff'
  surface-dim: '#d9d9e6'
  surface-bright: '#faf8ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f2ff'
  surface-container: '#ededfa'
  surface-container-high: '#e7e7f4'
  surface-container-highest: '#e1e1ef'
  on-surface: '#191b24'
  on-surface-variant: '#434656'
  inverse-surface: '#2e303a'
  inverse-on-surface: '#f0f0fd'
  outline: '#737688'
  outline-variant: '#c3c5d9'
  surface-tint: '#004fe5'
  primary: '#0047cf'
  on-primary: '#ffffff'
  primary-container: '#165dff'
  on-primary-container: '#eeefff'
  inverse-primary: '#b6c4ff'
  secondary: '#006e16'
  on-secondary: '#ffffff'
  secondary-container: '#6bfd6a'
  on-secondary-container: '#007317'
  tertiary: '#894000'
  on-tertiary: '#ffffff'
  tertiary-container: '#ae5300'
  on-tertiary-container: '#ffece2'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dce1ff'
  primary-fixed-dim: '#b6c4ff'
  on-primary-fixed: '#00164f'
  on-primary-fixed-variant: '#003bb0'
  secondary-fixed: '#72ff70'
  secondary-fixed-dim: '#4ee253'
  on-secondary-fixed: '#002203'
  on-secondary-fixed-variant: '#00530e'
  tertiary-fixed: '#ffdbc8'
  tertiary-fixed-dim: '#ffb689'
  on-tertiary-fixed: '#311300'
  on-tertiary-fixed-variant: '#733500'
  background: '#faf8ff'
  on-background: '#191b24'
  surface-variant: '#e1e1ef'
typography:
  display-lg:
    fontFamily: beVietnamPro
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: beVietnamPro
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-sm:
    fontFamily: inter
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  body-md:
    fontFamily: inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
  body-sm:
    fontFamily: inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  container-padding: 24px
  gutter: 16px
  margin-sm: 8px
  margin-md: 16px
  margin-lg: 24px
  layout-max-width: 1440px
---

## Brand & Style
The design system is engineered for high-density enterprise SaaS environments, prioritizing clarity, efficiency, and structural integrity. It follows a **Modern Corporate** aesthetic that balances the rigorous logic of a technical console with a sophisticated, warm environmental palette.

The visual narrative focuses on "Professional Warmth"—using a neutral, structured layout typical of cloud infrastructure consoles but softening the digital clinical feel with a textured, organic background. This reduces eye strain during long-duration monitoring and management tasks while maintaining the authoritative presence required for mission-critical operations.

## Colors
The color architecture utilizes a high-performance primary blue for action and focus, supported by a strict semantic system for status communication. 

### Palette Application
- **Primary Blue (#165DFF):** Used for primary actions, selection states, and progress indicators.
- **Semantic Logic:** Success (Connected), Warning (To Improve), and Error (Anomaly) follow standard Arco specifications to ensure immediate user recognition.
- **Background Strategy:** The page background deviates from standard white to a warm-toned light beige (#F9F8F6). A subtle 2% grain texture should be applied via a CSS overlay or noise SVG to add a tactile, premium feel to the workspace.
- **Grayscale:** Text hierarchy is strictly enforced using three tiers of gray to separate content density.

## Typography
The system employs a dual-font strategy. **Be Vietnam Pro** is used for large display headings to provide a modern, slightly friendly character. For technical data, body text, and interface labels, **Inter** (or **PingFang SC** for Chinese environments) provides maximum legibility at 14px.

- **Primary Size:** 14px is the base for all body and UI elements to maintain high information density.
- **Weight Logic:** Use Medium (500) for interactive elements (buttons, tabs) and Semibold (600) for structural section titles.
- **Line Height:** A consistent 1.5x ratio is maintained for body text to ensure readability in data-heavy tables.

## Layout & Spacing
The layout follows a **Fixed Grid** philosophy optimized for 1440px desktop displays. 

- **Sidebar:** A fixed 240px width navigation sidebar with a collapsible state (64px).
- **Grid:** A 12-column grid system with 16px gutters.
- **Rhythm:** An 8px base grid is used for component layout, but 4px increments are allowed for tight data-dense UI elements (like form fields and small tags).
- **Margins:** Standard page margins are set to 24px, providing a clear frame around card-based content.

## Elevation & Depth
Depth is achieved through **Tonal Layering** and subtle borders rather than aggressive shadows.

- **Level 0 (Background):** The warm-beige textured base layer.
- **Level 1 (Cards/Containers):** Flat white background with a 1px border (#E5E6EB). No shadow.
- **Level 2 (Popovers/Drawers):** Flat white with a soft, neutral drop shadow (0 4px 10px rgba(29, 33, 41, 0.1)) to indicate temporary overlay.
- **Dividers:** Use #F2F3F5 for horizontal rules within cards to separate sections without breaking visual flow.

## Shapes
The shape language is "Calculated and Geometric." Corner radii are used functionally to denote the scale of the element:

- **2px Radius:** Applied to Buttons, Tags, and Input fields. This "sharp-soft" corner conveys precision and professional rigor.
- **4px Radius:** Applied to Standard Cards and internal modules.
- **8px Radius:** Reserved for major page containers and large Drawers, framing the primary content areas.

## Components
This design system leverages the Arco Design component library with specific stylistic overrides:

- **Buttons:** Primary buttons use #165DFF with 2px corners. Hover state shifts to #4080FF. Text is always centered with 14px weight.
- **Tags:** Non-interactive tags use a "Tinted" style—background is a 10% opacity version of the status color, while text is the 100% saturation color (e.g., Success tag has a light green background with #00B42A text).
- **Cards:** White background, 4px radius, 1px #E5E6EB border. Title bars should be separated by a #F2F3F5 divider.
- **Tables:** Header background should be #F7F8FA. Cell text uses #1D2129. Row hover state should be a subtle #F2F3F5.
- **Tabs:** Borderless "Line" style tabs are preferred for page-level navigation, using the Primary Blue for the active indicator.
- **Switches & Radio:** Follow standard Arco sizing but ensure the active "On" state uses the primary #165DFF.