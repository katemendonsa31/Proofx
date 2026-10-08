"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import {
  Mic,
  Square,
  Loader2,
  CheckCircle2,
  RotateCcw,
  Save,
  X,
  Clock,
  Pencil,
  Upload,
  ArrowRight,
  Sparkles,
  Tag,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

type Status =
  | "idle"
  | "recording"
  | "transcribing"
  | "editing"
  | "extracting"
  | "reviewing"
  | "saving"
  | "success"
  | "error";

interface ActivityItem {
  summary: string;
  description: string;
  kra_name: string;
  mapping_reason: string;
  confidence_level: string;
  hours: number;
  entry_type: string;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "";

export default function RecordPage() {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [editedTranscript, setEditedTranscript] = useState("");
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [availableKras, setAvailableKras] = useState<string[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [recordingStartedAt, setRecordingStartedAt] = useState<Date | null>(null);

  const router = useRouter();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Recording timer
  useEffect(() => {
    if (status === "recording") {
      timerRef.current = setInterval(() => {
        setRecordingDuration((d) => d + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [status]);

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, "0");
    const s = (secs % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const reset = () => {
    setStatus("idle");
    setErrorMsg(null);
    setTranscript("");
    setEditedTranscript("");
    setActivities([]);
    setSuccessCount(0);
    setRecordingDuration(0);
    setRecordingStartedAt(null);
  };

  const startRecording = async () => {
    try {
      reset();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribeAudioBlob(blob, "recording.webm");
      };

      mediaRecorder.start(250);
      setRecordingStartedAt(new Date());
      setRecordingDuration(0);
      setStatus("recording");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg("Microphone access was denied. Please allow microphone access or upload an audio file.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && status === "recording") {
      mediaRecorderRef.current.stop();
      setStatus("transcribing");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    transcribeAudioBlob(file, file.name);
  };

  const transcribeAudioBlob = async (blob: Blob, filename: string) => {
    try {
      setStatus("transcribing");
      setErrorMsg(null);

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const formData = new FormData();
      formData.append("file", blob, filename);

      const response = await fetch(`${BACKEND}/api/v1/transcribe`, {
        method: "POST",
        headers,
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Transcription failed. Please try again.");
      }

      const data = await response.json();
      const rawTranscript = data.transcript || "";

      if (!rawTranscript.trim()) {
        throw new Error("No clear speech detected. Please speak clearly and try again.");
      }

      setTranscript(rawTranscript);
      setEditedTranscript(rawTranscript);
      setStatus("editing");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Failed to transcribe audio. Verify backend is running.");
    }
  };

  const handleExtractActivities = async () => {
    if (!editedTranscript.trim()) return;

    try {
      setStatus("extracting");
      setErrorMsg(null);

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`${BACKEND}/api/v1/extract-activities`, {
        method: "POST",
        headers,
        body: JSON.stringify({ transcript: editedTranscript }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Extraction failed.");
      }

      const data = await response.json();
      setActivities(data.activities || []);
      setAvailableKras(data.available_kras || ["Stakeholder Management", "Platform Architecture", "Team Health", "Unmapped"]);
      setStatus("reviewing");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Extraction failed. Please check backend connection.");
    }
  };

  const handleUpdateActivity = (index: number, field: keyof ActivityItem, value: any) => {
    setActivities((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleConfirmAndSave = async () => {
    try {
      setStatus("saving");
      setErrorMsg(null);

      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      // Calculate IST today date
      const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

      const response = await fetch(`${BACKEND}/api/v1/confirm-and-save`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          date: todayIST,
          activities,
          status: "confirmed",
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to confirm and save entries.");
      }

      const data = await response.json();
      setSuccessCount(data.saved_count || activities.length);
      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(err.message || "Save failed.");
    }
  };

  return (
    <div className="flex flex-col max-w-4xl mx-auto w-full gap-6">
      <PageHeader
        title="Voice &amp; Activity Capture"
        description="Record or upload your update. AI structures activities, maps them to KRAs, and lets you review before confirming."
      />

      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="audio/*"
        className="hidden"
      />

      {/* Error Banner */}
      {status === "error" && errorMsg && (
        <div className="w-full p-4 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-medium flex items-start gap-3">
          <X className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p>{errorMsg}</p>
            <button
              onClick={reset}
              className="mt-2 text-xs font-semibold underline hover:text-red-800"
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="bg-white border rounded-xl p-8 flex flex-col items-center gap-6 shadow-sm">

        {/* ── IDLE ── */}
        {status === "idle" && (
          <div className="flex flex-col items-center text-center gap-5 w-full max-w-md py-6">
            <div className="w-24 h-24 rounded-full flex items-center justify-center border-4 border-gray-100 bg-gray-50 text-gray-500 shadow-inner">
              <Mic className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Record Your Daily Update</h3>
              <p className="text-sm text-gray-500 mt-1">
                Speak naturally about what you worked on today in IST.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 w-full">
              <Button
                onClick={startRecording}
                className="flex-1 py-6 text-base font-semibold bg-[#1a1a1a] hover:bg-black text-white"
              >
                <Mic className="w-5 h-5 mr-2 text-red-400" />
                Start Voice Recording
              </Button>
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                className="py-6 text-base font-semibold border-gray-300"
              >
                <Upload className="w-4 h-4 mr-2 text-gray-500" />
                Upload Audio File
              </Button>
            </div>
          </div>
        )}

        {/* ── RECORDING ── */}
        {status === "recording" && (
          <div className="flex flex-col items-center text-center gap-5 py-6">
            <div className="relative">
              <div className="w-24 h-24 rounded-full flex items-center justify-center border-4 border-red-500 bg-red-50 animate-pulse text-red-500">
                <Mic className="w-10 h-10" />
              </div>
              <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 bg-red-600 text-white text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full shadow">
                {formatDuration(recordingDuration)}
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Recording In Progress...</h3>
              <p className="text-sm text-gray-500 mt-1">
                Mention your meetings, deliverables, and tasks.
              </p>
            </div>
            <Button
              onClick={stopRecording}
              className="px-8 py-6 text-base font-semibold bg-red-600 hover:bg-red-700 text-white"
            >
              <Square className="w-4 h-4 mr-2" />
              Stop &amp; Transcribe
            </Button>
          </div>
        )}

        {/* ── TRANSCRIBING ── */}
        {status === "transcribing" && (
          <div className="flex flex-col items-center text-center gap-4 py-8">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
            <h3 className="text-lg font-bold text-gray-900">Transcribing Audio...</h3>
            <p className="text-sm text-gray-500">Converting speech to text using Whisper AI.</p>
          </div>
        )}

        {/* ── EDITING TRANSCRIPT ── */}
        {status === "editing" && (
          <div className="w-full flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs text-gray-500 border-b pb-3">
              <span className="flex items-center gap-1 font-semibold text-blue-700">
                <Pencil className="w-3.5 h-3.5" /> Step 1: Review &amp; Edit Transcript
              </span>
              <span>Edit any words or misheard names before AI extraction</span>
            </div>

            <textarea
              value={editedTranscript}
              onChange={(e) => setEditedTranscript(e.target.value)}
              className="w-full min-h-[180px] p-4 text-sm leading-relaxed border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-600 bg-gray-50 text-gray-900"
              placeholder="Your speech transcript will appear here..."
              autoFocus
            />

            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleExtractActivities}
                disabled={!editedTranscript.trim()}
                className="px-6 py-5 font-bold bg-[#1a1a1a] hover:bg-black text-white flex-1"
              >
                <Sparkles className="w-4 h-4 mr-2 text-amber-300" />
                Extract Activities &amp; Map to KRAs
              </Button>
              <Button onClick={reset} variant="outline" className="px-5 py-5">
                <RotateCcw className="w-4 h-4 mr-2" />
                Re-record
              </Button>
            </div>
          </div>
        )}

        {/* ── EXTRACTING ── */}
        {status === "extracting" && (
          <div className="flex flex-col items-center text-center gap-4 py-8">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
            <h3 className="text-lg font-bold text-gray-900">Extracting Activities &amp; Mapping KRAs...</h3>
            <p className="text-sm text-gray-500">AI is mapping your tasks to KRAs with confidence scores and reasons.</p>
          </div>
        )}

        {/* ── REVIEWING & CONFIRMING ── */}
        {status === "reviewing" && (
          <div className="w-full flex flex-col gap-6">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Step 2: Review Extracted Activities</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Check KRA assignments, hours, and reasons. Edit any entry before confirming.
                </p>
              </div>
              <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full">
                {activities.length} Activities Found
              </span>
            </div>

            <div className="space-y-4">
              {activities.map((act, idx) => (
                <div key={idx} className="border rounded-lg p-5 bg-gray-50/50 flex flex-col gap-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <input
                      type="text"
                      value={act.summary}
                      onChange={(e) => handleUpdateActivity(idx, "summary", e.target.value)}
                      className="font-semibold text-gray-900 bg-white border px-3 py-1.5 rounded-md text-sm flex-1 w-full"
                    />

                    {/* KRA Selector */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Tag className="w-3.5 h-3.5 text-gray-400" />
                      <select
                        value={act.kra_name}
                        onChange={(e) => handleUpdateActivity(idx, "kra_name", e.target.value)}
                        className={`text-xs font-semibold px-2.5 py-1.5 rounded border ${
                          act.kra_name === "Unmapped"
                            ? "bg-amber-50 text-amber-800 border-amber-200"
                            : "bg-blue-50 text-blue-800 border-blue-200"
                        }`}
                      >
                        {availableKras.map((k) => (
                          <option key={k} value={k}>
                            {k}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Description */}
                  <textarea
                    value={act.description}
                    onChange={(e) => handleUpdateActivity(idx, "description", e.target.value)}
                    rows={2}
                    className="text-xs text-gray-600 bg-white border p-2 rounded-md resize-none"
                    placeholder="Activity description..."
                  />

                  {/* Metadata Row: Reason, Confidence, Hours */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-white p-3 rounded border">
                    <div>
                      <span className="font-semibold text-gray-700 flex items-center gap-1">
                        <Info className="w-3 h-3 text-blue-500" /> Mapping Reason:
                      </span>
                      <p className="text-gray-600 mt-0.5 italic">{act.mapping_reason || "None"}</p>
                    </div>

                    <div>
                      <span className="font-semibold text-gray-700">Confidence:</span>
                      <div className="mt-0.5">
                        <span
                          className={`px-2 py-0.5 rounded font-medium ${
                            act.confidence_level === "High"
                              ? "bg-emerald-100 text-emerald-800"
                              : act.confidence_level === "Medium"
                              ? "bg-blue-100 text-blue-800"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {act.confidence_level || "Medium"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-700">Hours:</span>
                      <input
                        type="number"
                        step="0.25"
                        min="0"
                        value={act.hours}
                        onChange={(e) => handleUpdateActivity(idx, "hours", parseFloat(e.target.value) || 0)}
                        className="w-16 px-2 py-1 border rounded text-xs text-right"
                      />
                      <span className="text-gray-400">h</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleConfirmAndSave}
                className="flex-1 py-6 font-bold bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 className="w-5 h-5 mr-2" />
                Confirm &amp; Update Daily Tracker
              </Button>
              <Button onClick={() => setStatus("editing")} variant="outline" className="py-6 font-semibold">
                Back to Transcript
              </Button>
            </div>
          </div>
        )}

        {/* ── SAVING ── */}
        {status === "saving" && (
          <div className="flex flex-col items-center text-center gap-4 py-8">
            <Loader2 className="w-12 h-12 text-emerald-600 animate-spin" />
            <h3 className="text-lg font-bold text-gray-900">Updating Daily Tracker...</h3>
            <p className="text-sm text-gray-500">Writing confirmed activities to Supabase database.</p>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {status === "success" && (
          <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="w-20 h-20 rounded-full flex items-center justify-center bg-emerald-100 text-emerald-600">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <div>
              <h3 className="text-2xl font-bold text-gray-900">{successCount} Activities Logged!</h3>
              <p className="text-sm text-gray-500 mt-1">
                Your daily tracker for today has been confirmed and updated.
              </p>
            </div>
            <div className="flex gap-3 mt-4">
              <Button
                onClick={() => router.push("/dashboard")}
                className="bg-[#1a1a1a] hover:bg-black text-white px-6 py-5 font-semibold"
              >
                View Daily Tracker
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button onClick={reset} variant="outline" className="px-6 py-5 font-semibold">
                Record Another Update
              </Button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
