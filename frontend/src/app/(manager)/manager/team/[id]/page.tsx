import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Calendar, CheckSquare, Target, Sparkles, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const ENTRY_TYPE_COLOR: Record<string, string> = {
  meeting: "bg-blue-500",
  deliverable: "bg-green-500",
  bug: "bg-amber-500",
  feature: "bg-purple-500",
  documentation: "bg-cyan-500",
  learning: "bg-indigo-500",
  other: "bg-gray-400",
};

export default async function EmployeeDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { date?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // Verify this manager is assigned to this employee or is admin
  const { data: mapping } = await supabase
    .from("employee_manager_map")
    .select("id")
    .eq("manager_id", user.id)
    .eq("employee_id", params.id)
    .maybeSingle();

  const { data: managerProfile } = await supabase
    .from("profiles")
    .select("role")
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = managerProfile?.role === "admin";
  if (!mapping && !isAdmin) {
    return notFound();
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, display_name, department, status, created_at")
    .eq("user_id", params.id)
    .maybeSingle();

  if (!profile) return notFound();

  // Selected date or default to today in IST
  const todayIST = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  const selectedDate = searchParams?.date || todayIST;

  // Fetch all recent entries for date picker
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const { data: allRecentEntries } = await supabase
    .from("work_entries")
    .select("work_date")
    .eq("user_id", params.id)
    .gte("work_date", thirtyDaysAgo)
    .order("work_date", { ascending: false });

  const recordedDates = Array.from(new Set((allRecentEntries ?? []).map((e) => e.work_date)));
  if (!recordedDates.includes(selectedDate)) {
    recordedDates.unshift(selectedDate);
  }

  // Fetch entries for the selected date
  const { data: dayEntries } = await supabase
    .from("work_entries")
    .select("*, kras(name)")
    .eq("user_id", params.id)
    .eq("work_date", selectedDate)
    .order("created_at", { ascending: false });

  // Fetch daily log status for submission state
  const { data: dailyLog } = await supabase
    .from("daily_logs")
    .select("status, summary_ai, confirmed_at")
    .eq("user_id", params.id)
    .eq("log_date", selectedDate)
    .maybeSingle();

  // Fetch active KRAs
  const { data: kras } = await supabase
    .from("kras")
    .select("*")
    .eq("user_id", params.id)
    .eq("is_active", true);

  const name = profile.full_name ?? profile.display_name ?? "Employee";
  const entries = dayEntries ?? [];
  const totalHours = entries.reduce((s, e) => s + parseFloat(e.hours || 0), 0);

  // Time by KRA breakdown
  const timeByKra: Record<string, number> = {};
  entries.forEach((e) => {
    const kName = e.kras?.name || "Unmapped";
    timeByKra[kName] = (timeByKra[kName] || 0) + parseFloat(e.hours || 0);
  });

  // KRAs with no activity
  const activeKraNames = (kras ?? []).map((k) => k.name);
  const workedKraNames = new Set(entries.map((e) => e.kras?.name).filter(Boolean));
  const unworkedKras = activeKraNames.filter((k) => !workedKraNames.has(k));

  return (
    <div className="flex flex-col gap-8 pb-12 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <Link
          href="/manager/team"
          className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Team
        </Link>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center text-2xl font-bold text-blue-700">
              {name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{name}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {profile.department ?? "Engineering"} · {profile.status ?? "Active"}
              </p>
            </div>
          </div>

          {/* Date Picker Form */}
          <form method="GET" className="flex items-center gap-3 bg-white border p-2 rounded-xl shadow-sm">
            <span className="text-xs font-semibold text-gray-500 pl-2">Select Date (IST):</span>
            <input
              type="date"
              name="date"
              defaultValue={selectedDate}
              className="text-sm font-semibold border rounded-lg px-3 py-1.5 text-gray-800 bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button
              type="submit"
              className="bg-[#1a1a1a] hover:bg-black text-white text-xs font-semibold px-4 py-2 rounded-lg"
            >
              View Day
            </button>
          </form>
        </div>
      </div>

      {/* Submission Status & Summary Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-5 flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-500">Submission Status</span>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2.5 py-1 rounded-full font-bold uppercase ${
                dailyLog?.status === "confirmed"
                  ? "bg-emerald-100 text-emerald-800"
                  : entries.length > 0
                  ? "bg-amber-100 text-amber-800"
                  : "bg-red-100 text-red-800"
              }`}
            >
              {dailyLog?.status === "confirmed"
                ? "Confirmed"
                : entries.length > 0
                ? "Draft"
                : "Missing Submission"}
            </span>
            {dailyLog?.confirmed_at && (
              <span className="text-xs text-gray-400">
                at {new Date(dailyLog.confirmed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>

        <div className="bg-white border rounded-xl p-5 flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-500">Total Hours Logged</span>
          <p className="text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}h</p>
        </div>

        <div className="bg-white border rounded-xl p-5 flex flex-col gap-2">
          <span className="text-xs font-semibold text-gray-500">Activities Captured</span>
          <p className="text-2xl font-bold text-gray-900">{entries.length}</p>
        </div>
      </div>

      {/* AI Daily Summary Card */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-6">
        <div className="flex items-center gap-2 text-blue-900 font-bold mb-2">
          <Sparkles className="w-5 h-5 text-blue-600" />
          <h3>AI Manager Summary for {selectedDate}</h3>
        </div>
        <p className="text-sm text-blue-950 leading-relaxed">
          {entries.length === 0
            ? "No updates or activities have been recorded by the employee for this date yet."
            : dailyLog?.summary_ai ||
              `Employee logged ${totalHours.toFixed(1)} hours across ${entries.length} activities on ${selectedDate}. Key focus areas included ${Object.keys(timeByKra).join(", ")}.`}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Activities with KRA, Reason, and Confidence */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">Activities for {selectedDate}</h2>
            <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2 py-1 rounded">
              {entries.length} items
            </span>
          </div>

          {entries.length === 0 ? (
            <div className="bg-white border rounded-xl p-8 text-center text-gray-400 text-sm">
              No activities found for this date.
            </div>
          ) : (
            <div className="space-y-4">
              {entries.map((entry) => (
                <div key={entry.id} className="bg-white border rounded-xl p-5 flex flex-col gap-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded font-semibold ${
                        entry.kras?.name
                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                          : "bg-amber-50 text-amber-800 border border-amber-200"
                      }`}
                    >
                      {entry.kras?.name || "Unmapped"}
                    </span>
                    <span className="text-sm font-bold text-gray-700">{entry.hours}h</span>
                  </div>

                  <div>
                    <h4 className="font-semibold text-gray-900 text-base">{entry.summary}</h4>
                    {entry.details && <p className="text-xs text-gray-600 mt-1">{entry.details}</p>}
                  </div>

                  <div className="bg-gray-50 p-3 rounded-lg flex flex-col sm:flex-row gap-3 text-xs border border-gray-100">
                    <div className="flex-1">
                      <span className="font-semibold text-gray-500">Mapping Reason:</span>
                      <p className="text-gray-700 mt-0.5">{entry.mapping_reason || "Direct employee confirmation"}</p>
                    </div>
                    {entry.confidence_level && (
                      <div>
                        <span className="font-semibold text-gray-500">Confidence:</span>
                        <p className="font-bold text-gray-800 mt-0.5">{entry.confidence_level}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Time by KRA & Unworked KRAs */}
        <div className="space-y-6">
          <h2 className="text-lg font-bold text-gray-900">Time by KRA</h2>
          <div className="bg-white border rounded-xl p-5 space-y-4 shadow-sm">
            {Object.keys(timeByKra).length === 0 ? (
              <p className="text-xs text-gray-400">No time recorded.</p>
            ) : (
              Object.entries(timeByKra).map(([kraName, hours]) => {
                const pct = totalHours > 0 ? ((hours / totalHours) * 100).toFixed(0) : 0;
                return (
                  <div key={kraName} className="space-y-1.5">
                    <div className="flex justify-between text-xs font-semibold">
                      <span className="text-gray-800 truncate">{kraName}</span>
                      <span className="text-gray-500">{hours.toFixed(1)}h ({pct}%)</span>
                    </div>
                    <div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <h2 className="text-lg font-bold text-gray-900">KRAs With No Activity</h2>
          <div className="bg-white border rounded-xl p-5 shadow-sm">
            {unworkedKras.length === 0 ? (
              <p className="text-xs text-emerald-600 font-semibold flex items-center gap-1.5">
                <CheckSquare className="w-4 h-4" /> All active KRAs were addressed today!
              </p>
            ) : (
              <div className="space-y-2">
                {unworkedKras.map((kraName) => (
                  <div
                    key={kraName}
                    className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-900"
                  >
                    <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span className="font-medium">{kraName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
