# Expenso API

Backend for shared / family group expenses.

## Setup

1. Copy env file:
```bash
cp .env.example .env
```

2. Edit `.env`:
- Replace `YOUR_DB_PASSWORD_HERE` with your MongoDB Atlas password
- Set a strong `JWT_SECRET`

3. Install & run:
```bash
cd server
npm install
npm run dev
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Create account |
| POST | `/api/auth/login` | No | Login |
| GET | `/api/auth/me` | Yes | Current user |
| GET | `/api/groups` | Yes | My groups |
| POST | `/api/groups` | Yes | Create group |
| POST | `/api/groups/join` | Yes | Join via invite code |
| GET | `/api/groups/:id` | Yes | Group detail |
| GET | `/api/groups/:groupId/expenses` | Yes | List shared expenses |
| POST | `/api/groups/:groupId/expenses` | Yes | Add shared expense |
| DELETE | `/api/groups/:groupId/expenses/:expenseId` | Yes | Delete expense |

Auth header: `Authorization: Bearer <token>`
