# VittaSetu

AI-assisted banking for small businesses (MSMEs). One place for a passbook ledger, loan EMI and applications, inventory, GST invoices, government scheme matching and a chatbot assistant called **Samarth**.

Built for Smart India Hackathon.

## Features

- **Sign up and log in** with validation, JWT sessions and hashed passwords
- **Passbook:** record credits and debits, filter them, see balance and totals
- **Loan calculator:** EMI, total interest and a month-by-month schedule, plus loan applications saved to the database
- **Inventory:** stock tracking with reorder alerts and a movement log
- **GST invoice generator:** CGST/SGST/IGST calculation and PDF download
- **Government scheme matcher:** shows which central schemes a business may qualify for
- **Samarth chatbot:** answers questions about loans, EMI and the app (via OpenRouter)

## Tech stack

| Part | Technology |
| --- | --- |
| Frontend | Plain HTML, CSS and JavaScript |
| Backend | Node.js, Express |
| Database | PostgreSQL on Supabase |
| Auth | JWT, bcryptjs |
| Chatbot | OpenRouter API |
| Hosting | Netlify (frontend), Render (backend) |

## Project structure

```
vittasetu-full-project/
├── backend/
│   ├── db.js              # PostgreSQL connection and table setup
│   ├── server.js          # Express app entry point
│   ├── middleware/auth.js # JWT check
│   ├── routes/            # auth, transactions, loan, inventory, chat
│   ├── utils/             # stock logic, validators, error helpers
│   ├── package.json
│   └── .env.example
└── public/
    └── html/              # the whole frontend
        ├── *.html
        ├── css/
        └── js/
```

## Run it locally

You need Node.js 18 or newer and a Supabase project.

1. **Install packages**
   ```bash
   cd backend
   npm install
   ```
2. **Create `backend/.env`** by copying `.env.example` and filling in the values (see the table below).
3. **Start the server**
   ```bash
   npm start
   ```
   The tables are created automatically on the first start.
4. Open **http://localhost:5000** in the browser.

> Open the site through port 5000. Opening the HTML files with another tool (like Live Server) means API calls will not reach the backend unless the API address is changed in `public/html/js/app-shell.js` and `auth.js`.

## Environment variables

| Name | What it is |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres connection string. Use the **Session pooler** URI |
| `JWT_SECRET` | A long random string used to sign login tokens |
| `OPENROUTER_API_KEY` | API key for the chatbot |
| `OPENROUTER_MODEL` | Model name, for example `openrouter/free` |
| `FRONTEND_URL` | Your Netlify site address, used for CORS (live only) |
| `APP_URL` | Your site address, sent to OpenRouter (optional) |
| `PORT` | Set by Render automatically. Defaults to 5000 locally |

Never commit the real `.env` file. It is already in `.gitignore`.

## Deployment

**Backend on Render**
- Root Directory: `backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Add the environment variables from the table above
- Health check: `/api/health`

**Frontend on Netlify**
- Publish directory: `public/html`
- No build command
- In `public/html/js/app-shell.js` and `public/html/js/auth.js`, set the Render address inside `API_BASE`

After both are live, set `FRONTEND_URL` on Render to the Netlify address so the browser is allowed to call the API.

The free Render plan sleeps after about 15 minutes without traffic, so the first request after a break can take up to a minute.

## API overview

All routes except sign up and log in need an `Authorization: Bearer <token>` header.

| Route | Purpose |
| --- | --- |
| `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/me` | Accounts |
| `GET/POST /api/transactions`, `GET /api/transactions/summary`, `DELETE /api/transactions/:id` | Passbook |
| `POST /api/loan/calculate`, `POST /api/loan/apply` | Loans |
| `GET /api/inventory` and item, restock, adjust, sale routes | Inventory |
| `POST /api/chat`, `GET /api/chat/history` | Samarth chatbot |
| `GET /api/health` | Server and database check |

## Known limitations

- The inventory page currently stores its data in the browser (localStorage). The backend inventory routes are ready but the page is not connected to them yet.
- Passbook sales do not reduce stock automatically yet.
- Loan applications are saved as `pending`. There is no automatic approval.
- Scheme details are a guide only. Always confirm on the official website.

## 
Admin- Aditya yadav
