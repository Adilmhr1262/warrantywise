# WarrantyWise

Personal Warranty & Product Ownership Tracker. A small, complete, static web app: keep track of the products you own, their warranty periods, purchase information, and service history — privately in your browser, no account, no cloud.

## Features

- **Dashboard** — total products, active / expiring-soon / expired warranty counts, upcoming expirations, recently added products.
- **My Products** — search (name, brand, retailer, serial, notes), category and warranty-status filters, sorting by warranty end, purchase date, recently added, or name.
- **Add / Edit Product** — validated form: name (required), brand, category (built-ins plus custom), purchase date, warranty end date, price, retailer, serial number, notes.
- **Warranty status, computed locally** — Active, Expiring soon (inside a configurable alert window, default 30 days), Expired, or No warranty. Dates are local dates, never UTC.
- **Product details & service history** — full product information plus repair / maintenance / inspection records per product (date, type, description, cost, provider), each editable and deletable.
- **Settings** — alert window (1–90 days), currency preference, light/dark theme, storage use, JSON export / validated import, two-step delete-all.
- **Data safety** — versioned localStorage backups, full validation before any import replaces data (duplicate ids, bad dates, warranty-before-purchase, over-long fields all rejected with data unchanged), corrupt storage starts empty with a warning and leaves the raw value untouched, failed saves roll back to the previous value.

## Tech

Vanilla HTML5, CSS3, JavaScript. localStorage only, no backend, no dependencies, no external requests. Starts completely empty — no demo data. Responsive (sidebar on desktop, bottom nav on mobile), light and dark themes, service worker for offline use.

## Run locally

Serve the folder over HTTP (service worker needs it), e.g. `python3 -m http.server 8000`, then open `http://127.0.0.1:8000/index.html`.

## License

MIT.
