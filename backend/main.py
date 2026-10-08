import os
import json
import re
from typing import List, Optional
from datetime import datetime
import pytz
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
import tempfile
from difflib import SequenceMatcher

from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client

load_dotenv()

app = FastAPI(title="ProofX AI Work Intelligence API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TIMEZONE_NAME = os.getenv("DEFAULT_TIMEZONE", "Asia/Kolkata")

# Setup AI Client (Groq preferred if available, or OpenAI)
ai_client: Optional[OpenAI] = None
is_groq = False

if GROQ_API_KEY:
    ai_client = OpenAI(
        api_key=GROQ_API_KEY,
        base_url="https://api.groq.com/openai/v1"
    )
    is_groq = True
elif OPENAI_API_KEY:
    ai_client = OpenAI(api_key=OPENAI_API_KEY)
    is_groq = False

security = HTTPBearer()

def get_ist_now():
    tz = pytz.timezone(TIMEZONE_NAME)
    return datetime.now(tz)

def get_ist_today_str() -> str:
    return get_ist_now().strftime("%Y-%m-%d")

def get_user_client(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """
    Creates a Supabase client authenticated with the user's token.
    Falls back to service client if available for seamless access.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    token = credentials.credentials
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    
    user_id = None
    try:
        user_response = client.auth.get_user(token)
        if user_response and user_response.user:
            user_id = user_response.user.id
    except Exception as e:
        print("User token lookup error:", e)

    if not user_id:
        if SUPABASE_SERVICE_KEY:
            try:
                service = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
                user_res = service.auth.get_user(token)
                if user_res and user_res.user:
                    user_id = user_res.user.id
            except Exception as e2:
                print("Service user lookup error:", e2)

    if not user_id:
        raise HTTPException(status_code=401, detail="Authentication failed or token invalid")

    client.postgrest.auth(token)
    return client, user_id


# ──────────────────────────────────────────
# Pydantic Schemas
# ──────────────────────────────────────────

class WorkEntrySchema(BaseModel):
    summary: str = Field(description="A concise summary of the work item.")
    description: Optional[str] = Field(default=None, description="Detailed context or notes.")
    kra_name: str = Field(default="Unmapped", description="Exact KRA name or 'Unmapped'.")
    mapping_reason: str = Field(default="", description="One-line reason explaining the mapping.")
    confidence_level: str = Field(default="Medium", description="High, Medium, or Low")
    hours: float = Field(default=0.5, description="Estimated hours spent.")
    entry_type: str = Field(default="other", description="meeting, deliverable, documentation, learning, bug, feature, other")

class ExtractedWork(BaseModel):
    activities: List[WorkEntrySchema] = Field(description="List of distinct extracted activities.")

class ExtractActivitiesRequest(BaseModel):
    transcript: str
    target_date: Optional[str] = None

class ConfirmActivityItem(BaseModel):
    summary: str
    description: Optional[str] = None
    kra_name: str
    mapping_reason: Optional[str] = None
    confidence_level: Optional[str] = "Medium"
    hours: float = 0.5
    entry_type: str = "other"

class ConfirmSaveRequest(BaseModel):
    date: str
    activities: List[ConfirmActivityItem]
    status: str = "confirmed"

class ManagerSummaryRequest(BaseModel):
    employee_id: str
    date: str


# ──────────────────────────────────────────
# AI Extraction Core
# ──────────────────────────────────────────

def extract_activities_from_transcript(transcript: str, user_kras: list) -> List[WorkEntrySchema]:
    if not ai_client:
        raise HTTPException(status_code=500, detail="AI service not configured (Missing Groq or OpenAI key)")

    kra_list_text = ""
    if user_kras:
        kra_list_text = "Active KRAs:\n" + "\n".join([f"- {k['name']}: {k.get('description', '')}" for k in user_kras])
    else:
        kra_list_text = "No KRAs configured yet. All entries should be 'Unmapped'."

    prompt = f"""You are an expert AI work tracker and performance mapping assistant.
Analyze the following employee daily voice/text update and extract DISTINCT individual work activities.

User's KRAs:
{kra_list_text}

Rules:
1. Break down into DISTINCT work items (one item per meeting/task/code/deliverable).
2. For each activity, determine:
   - summary: concise, professional title (e.g., 'Coordinated mentor availability with TiE team')
   - description: 1-2 sentence context detailing what was accomplished
   - kra_name: the EXACT matching KRA name from the list above. If it does not clearly match any active KRA (or is personal/unrelated), mark it EXACTLY as 'Unmapped'. NEVER FORCE A MAPPING.
   - mapping_reason: one clear sentence explaining why it maps to that KRA, or why it is marked Unmapped.
   - confidence_level: 'High', 'Medium', or 'Low'
   - hours: reasonable time spent in hours (default 0.5 if unspecified, morning work ~ 3.5h)
   - entry_type: one of 'meeting', 'deliverable', 'documentation', 'learning', 'bug', 'feature', 'other'

Return valid JSON with the key "activities" containing an array of activity objects.

Transcript:
\"\"\"{transcript}\"\"\"
"""

    model_name = "openai/gpt-oss-120b" if is_groq else "gpt-4o-mini"
    
    try:
        response = ai_client.chat.completions.create(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
            temperature=0.1
        )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)
        
        raw_items = parsed.get("activities", [])
        if not raw_items and isinstance(parsed, list):
            raw_items = parsed

        results: List[WorkEntrySchema] = []
        for item in raw_items:
            k_name = item.get("kra_name") or "Unmapped"
            if user_kras:
                matched = next((k["name"] for k in user_kras if k["name"].lower() == k_name.lower()), None)
                if matched:
                    k_name = matched
                elif k_name.lower() != "unmapped":
                    k_name = "Unmapped"
            else:
                k_name = "Unmapped"

            results.append(WorkEntrySchema(
                summary=item.get("summary", "Untitled activity"),
                description=item.get("description", ""),
                kra_name=k_name,
                mapping_reason=item.get("mapping_reason", "Extracted from work diary."),
                confidence_level=item.get("confidence_level", "Medium"),
                hours=float(item.get("hours", 0.5)),
                entry_type=item.get("entry_type", "other")
            ))

        return results

    except Exception as e:
        print("Extraction error:", e)
        raise HTTPException(status_code=500, detail=f"AI extraction failed: {str(e)}")


def is_entry_duplicate(new_summary: str, existing_summaries: List[str], threshold: float = 0.8) -> bool:
    for ex in existing_summaries:
        ratio = SequenceMatcher(None, new_summary.lower().strip(), ex.lower().strip()).ratio()
        if ratio >= threshold:
            return True
    return False


# ──────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "app": "ProofX AI Tracker",
        "engine": "Groq" if is_groq else "OpenAI",
        "timezone": TIMEZONE_NAME,
        "ist_time": get_ist_now().isoformat()
    }


@app.post("/api/v1/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    auth: tuple = Depends(get_user_client),
):
    """
    Transcribes audio using Whisper. Returns transcript for user review/editing.
    """
    if not ai_client:
        raise HTTPException(status_code=500, detail="AI transcription service not configured")

    temp_audio_path = None
    try:
        suffix = os.path.splitext(file.filename or "")[1] or ".webm"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await file.read()
            if len(content) == 0:
                raise HTTPException(status_code=400, detail="Uploaded audio file is empty.")
            tmp.write(content)
            temp_audio_path = tmp.name

        whisper_model = "whisper-large-v3" if is_groq else "whisper-1"

        with open(temp_audio_path, "rb") as audio_file:
            response = ai_client.audio.transcriptions.create(
                model=whisper_model,
                file=audio_file,
                response_format="text"
            )

        transcript = str(response).strip()
        
        # Clean silence hallucinations
        if not transcript or transcript in ["you", "Thank you.", "Bye.", "MBC 뉴스", "MBC"]:
            # If the audio was completely silent or hallucinated single filler
            raise HTTPException(status_code=422, detail="No clear speech detected. Please speak clearly and try again.")

        return {"transcript": transcript}

    except HTTPException:
        raise
    except Exception as e:
        print("Transcription error:", e)
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        if temp_audio_path and os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)


@app.post("/api/v1/extract-activities")
async def extract_activities_endpoint(
    request: ExtractActivitiesRequest,
    auth: tuple = Depends(get_user_client),
):
    """
    Extracts distinct activities, maps them to KRAs with reasons and confidence scores.
    Does NOT save to DB yet — allows employee review & edits.
    """
    supabase, user_id = auth
    transcript = request.transcript.strip()
    if not transcript:
        raise HTTPException(status_code=400, detail="Transcript cannot be empty.")

    # Fetch user's active KRAs
    try:
        kra_res = supabase.table("kras").select("id, name, description").eq("user_id", user_id).eq("is_active", True).execute()
        user_kras = kra_res.data or []
    except Exception as e:
        print("Error fetching KRAs:", e)
        user_kras = []

    activities = extract_activities_from_transcript(transcript, user_kras)

    target_date = request.target_date or get_ist_today_str()

    return {
        "date": target_date,
        "activities": [a.model_dump() for a in activities],
        "available_kras": [k["name"] for k in user_kras] + ["Unmapped"]
    }


@app.post("/api/v1/confirm-and-save")
async def confirm_and_save_endpoint(
    request: ConfirmSaveRequest,
    auth: tuple = Depends(get_user_client),
):
    """
    Saves confirmed activities into daily tracker for the specified IST date.
    Prevents duplicates on multiple recordings within the same day.
    """
    supabase, user_id = auth
    target_date = request.date or get_ist_today_str()

    # Load active KRAs
    try:
        kra_res = supabase.table("kras").select("id, name").eq("user_id", user_id).execute()
        kra_map = {k["name"].lower().strip(): k["id"] for k in (kra_res.data or [])}
    except Exception:
        kra_map = {}

    # Check or create daily log for target date
    try:
        daily_res = supabase.table("daily_logs").select("id").eq("user_id", user_id).eq("log_date", target_date).execute()
        if daily_res.data and len(daily_res.data) > 0:
            daily_log_id = daily_res.data[0]["id"]
            if request.status == "confirmed":
                supabase.table("daily_logs").update({
                    "status": "confirmed",
                    "confirmed_at": datetime.now(pytz.utc).isoformat()
                }).eq("id", daily_log_id).execute()
        else:
            new_log = supabase.table("daily_logs").insert({
                "user_id": user_id,
                "log_date": target_date,
                "status": request.status
            }).execute()
            daily_log_id = new_log.data[0]["id"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize daily log: {e}")

    # Fetch existing entries for target date to prevent duplicates (T4)
    existing_entries_res = supabase.table("work_entries").select("summary").eq("user_id", user_id).eq("work_date", target_date).execute()
    existing_summaries = [e["summary"] for e in (existing_entries_res.data or [])]

    inserted = []
    skipped = []

    for act in request.activities:
        if is_entry_duplicate(act.summary, existing_summaries):
            skipped.append(act.summary)
            continue

        kra_id = kra_map.get(act.kra_name.lower().strip()) if act.kra_name.lower().strip() != "unmapped" else None

        row = {
            "user_id": user_id,
            "daily_log_id": daily_log_id,
            "entry_type": act.entry_type,
            "summary": act.summary,
            "details": act.description,
            "kra_id": kra_id,
            "hours": act.hours,
            "status": request.status,
            "work_date": target_date,
            "mapping_reason": act.mapping_reason,
            "confidence_level": act.confidence_level,
            "is_ai_generated": True
        }

        try:
            ins_res = supabase.table("work_entries").insert(row).execute()
            if ins_res.data:
                inserted.append(ins_res.data[0])
                existing_summaries.append(act.summary)
        except Exception as e:
            print("Insert work entry error:", e)

    return {
        "status": "success",
        "date": target_date,
        "saved_count": len(inserted),
        "skipped_duplicates": len(skipped),
        "entries": inserted
    }


@app.post("/api/v1/manager/daily-summary")
async def generate_manager_daily_summary(
    request: ManagerSummaryRequest,
    auth: tuple = Depends(get_user_client),
):
    """
    Generates an AI executive summary for a manager viewing an employee's day.
    """
    supabase, caller_id = auth
    emp_id = request.employee_id
    day = request.date

    # Fetch entries for the employee on that day
    entries_res = supabase.table("work_entries").select("summary, details, hours, kra_id, entry_type, kras(name)").eq("user_id", emp_id).eq("work_date", day).execute()
    entries = entries_res.data or []

    if not entries:
        return {"summary": "No activities recorded for this date."}

    activities_text = "\n".join([
        f"- {e['summary']} ({e.get('hours', 0.5)}h) [KRA: {e.get('kras', {}).get('name') if e.get('kras') else 'Unmapped'}]"
        for e in entries
    ])

    prompt = f"""Summarize the following employee's workday for their manager in 2-3 concise, impactful bullet points:

Work entries:
{activities_text}
"""
    try:
        resp = ai_client.chat.completions.create(
            model="openai/gpt-oss-120b" if is_groq else "gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )
        return {"summary": resp.choices[0].message.content.strip()}
    except Exception as e:
        return {"summary": f"Employee completed {len(entries)} tasks across active KRAs."}
