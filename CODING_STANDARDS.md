# Coding standards

## Adapters

Browser, mail, and storage are separate modules. Each adapter lives in its own module and does not implement another adapter's job. The product module owns the rules. Adapters call that module and do not decide product rules.

- **Browser** — HTTP, HTML, and the sign-in cookie.
- **Mail** — delivering a magic link to an email.
- **Storage** — reading and writing the product snapshot.
