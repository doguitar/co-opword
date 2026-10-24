# Coding standards

## Adapters

Browser, mail, and storage are separate modules. Each adapter lives in its own module and does not implement another adapter's job. The product module owns the rules. Adapters call that module and do not decide product rules.

- **Browser** — HTTP, HTML, and the sign-in cookie.
- **Mail** — delivering a magic link to an email.
- **Storage** — reading and writing the product snapshot.

## Pages

HTML lives in HTML files. The browser module serves those files. It does not assemble a page as a string of markup in TypeScript or any other module.

CSS lives in CSS files. A stylesheet that a compiler writes is fine. The HTML does not contain CSS: no `<style>` element, no `style` attribute, and no stylesheet text pasted into a template. Link the CSS file from the HTML file.

The look is a black and white newspaper crossword. The rules and the reference pictures are in `docs/newspaper.md`. HTML and CSS follow those pictures. They do not invent a second look.

Any change to a UI element requires a new regression screenshot of every page that shows it. See `docs/regression.md`.
