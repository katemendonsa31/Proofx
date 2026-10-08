# ProofX - AI KRA & Work Tracker

An intelligent daily work tracking system built with Next.js 15, FastAPI, Groq / OpenAI Whisper & LLMs, and Supabase.

Employees record or upload voice updates, which are automatically transcribed, decomposed into distinct activities, mapped to employee KRAs with confidence scores and one-line reasons, and logged in IST timezone. Unmapped work is strictly isolated, and managers get team-restricted oversight enforced by Supabase Row-Level Security (RLS).

---

## Architecture & Tech Stack

- **Frontend:** Next.js 15 (App Router, Tailwind CSS, Lucide Icons)
- **Backend API:** FastAPI (Python 3.11+, Pydantic v2, PyTZ)
- **AI Engine:** Dual-Engine architecture supporting **Groq** (`whisper-large-v3` + `openai/gpt-oss-120b`) and **OpenAI** (`whisper-1` + `gpt-4o-mini`)
- **Database & Auth:** Supabase (PostgreSQL with RLS, Auth)
- **Deployment:** Vercel (Frontend & Serverless Python Backend)

---

## Quick Start & Local Setup

### 1. Prerequisites
- Node.js 18+ & npm
- Python 3.10+
- Supabase Project & Groq / OpenAI API Key

### 2. Configure Environment Variables
Copy `.env.example` to `backend/.env` and `frontend/.env.local`:
```bash
cp .env.example backend/.env
cp .env.example frontend/.env.local
```

### 3. Database Migration
Run `supabase/migrations/0001_full_schema.sql` in your **Supabase SQL Editor** ([https://supabase.com/dashboard](https://supabase.com/dashboard)).

### 4. Seed Users and KRAs
```bash
python3 -m venv backend/venv
source backend/venv/bin/activate
pip install -r backend/requirements.txt
python backend/seed_data.py
```

### 5. Run the Application
**Backend Server:**
```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

**Frontend App:**
```bash
cd frontend
npm install
npm run dev
```

The application is accessible at [http://localhost:3000](http://localhost:3000).

---

## Seed Credentials

| Role | Email | Password | Access Scope |
|---|---|---|---|
| **Admin** | `admin@proofx.io` | `AdminPassword123!` | System dashboard, user management, team mapping |
| **Manager** | `manager@proofx.io` | `ManagerPassword123!` | Assigned team members only, daily KRA review, AI summaries |
| **Employee** | `employee@proofx.io` | `EmployeePassword123!` | Voice/audio recording, transcript edit, daily tracker |

---

## Testing Scenarios (T1 - T8)

Run the automated test suites:

```bash
# 1. Run backend pytest extraction and mapping tests
pytest backend/test_extraction_suite.py

# 2. Benchmark KRA mapping accuracy across 10+ samples
python backend/test_accuracy.py
```
