# Newspaper look

Pages should look like a crossword printed in a black and white newspaper. Every desktop page must keep its masthead, double rule, serif, hairline grid, solid black squares, and flat grey buttons. CSS and HTML move toward this written spec. Do not invent a second desktop look.

## Ink

Only black, white, and flat grey. No hue. No gradient, no shadow, no glow, no photograph, no person, and no rounded card. Paper is white. Ink is black. A grey is a flat tint used for a rule, a block square, or a quiet label. Exception: the shared page-curl menu may use greyscale gradients and soft cast shadow for curl lighting only — the skewed curl strip and the reveal-shade over the uncovered menu wedge. Nothing else on the page gets a shadow or gradient.

The shared menu peels from the upper left. Registered fold endpoints on `.spread` draw one full-height fold line whose lower end starts offscreen; open values sweep it across the viewport. The real leaf is viewport-fixed with that clip, so tall pages scroll inside the face and stay aligned with the fixed curl. Menu stays under the leaf; a button toggles open state with `aria-expanded`, `inert` on the closed menu and on the leaf while open, Escape and focus restore, and session keyboard handlers ignore keys while the menu is open. Narrow viewports use wider open fold values; `prefers-reduced-motion` collapses the fold transition.

Type is a serif, as on a news page. The masthead is the word Co-opword, large, with a thick rule under it and a thin rule above it. Section titles are smaller serif headlines. Body text and clues are a smaller serif. Links are black and underlined, not blue.

Controls are plain: a label, a rectangular field with a hairline border, and a word as the button. A filled action is black type on white, or white type in a solid black rectangle. Nothing else is a button shape.

Use the width of the frame before adding height. Regions that can sit side by side flow left to right and wrap, so the page stays short.

Two frames, same ink. The smallest supported landscape viewport is 1440 by 900. At that size the header, the footer, the whole Grid, and two lines of players are on screen together. The page itself does not scroll. The clues scroll inside their own column. A viewport narrower than 1440 or shorter than 900 uses the mobile frame. That frame is a single column. It is not built yet, and the stylesheet still uses its old break. The desktop frame is landscape, from that minimum up through 1920 by 1080. The masthead spans the top. A page that has a Grid puts the Grid on the left and the clues or controls on the right. A page that is only words stays a short column on the left, with empty paper to the right.

## The Grid

The Grid is a table of equal squares with hairline black borders. A white Square is empty or holds one black capital letter. A black Square is solid black. Letters sit in the middle of the square. Clues sit under the Grid in two columns, Across and Down. Each clue is one line: direction, length, and the clue.

## Visual prompt

Use the written criteria above when generating or reviewing a page. Regression screenshots document current output, not target designs.

```
Flat greyscale screenshot of one web page, not a photo of paper on a desk. Newspaper crossword. White background, black ink, a few flat greys. Serif masthead "Co-opword" with a thick rule under it. Thin rules. No color, no blue links, no photos, no people, no shadows (except page-curl menu lighting on the curl strip and reveal shade), no rounded cards. Crossword cells are equal squares with hairline borders. Black squares are solid black. White squares hold at most one black capital.
```

Phone frame: `Portrait 9:16 phone. One narrow column. Stack every region.`

Desktop frame: `Landscape 16:9 desktop, 1920 by 1080. Masthead across the top. If the page has a Grid, Grid on the left and the other text on the right. If it is only words, keep them in a left column and leave the right side empty paper.`


[You have received this identical output 3 times. Re-reading 'C:\Users\seanseymour\source\repos\coopword\docs\newspaper.md:raw' will not change it — use a narrower selector (path:A-B), or proceed with the edit.]