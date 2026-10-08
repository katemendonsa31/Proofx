from dotenv import load_dotenv
load_dotenv()
import os
from supabase import create_client

url = os.getenv("SUPABASE_URL")
key = os.getenv("SUPABASE_SERVICE_KEY")

if not url or not key:
    raise RuntimeError("SUPABASE_URL or SUPABASE_SERVICE_KEY missing")

supabase = create_client(url, key)

users_to_seed = [
    {"email": "admin@proofx.io", "password": "AdminPassword123!", "role": "admin", "full_name": "System Admin"},
    {"email": "manager@proofx.io", "password": "ManagerPassword123!", "role": "manager", "full_name": "Operations Manager"},
    {"email": "employee@proofx.io", "password": "EmployeePassword123!", "role": "employee", "full_name": "John Employee"},
]

print("Seeding users...")
created_ids = {}

for u in users_to_seed:
    try:
        res = supabase.auth.admin.create_user({
            "email": u["email"],
            "password": u["password"],
            "email_confirm": True,
            "user_metadata": {"full_name": u["full_name"]}
        })
        uid = res.user.id
        print(f"Created user {u['email']} -> {uid}")
    except Exception as e:
        print(f"User {u['email']} already exists or err: {e}")
        # Find existing
        all_users = supabase.auth.admin.list_users()
        uid = next((x.id for x in all_users if x.email == u["email"]), None)
        if uid:
            supabase.auth.admin.update_user_by_id(uid, {"password": u["password"], "email_confirm": True})
            print(f"Found existing {u['email']} -> {uid}")

    if uid:
        created_ids[u["role"]] = uid
        # Upsert profile
        try:
            supabase.table("profiles").upsert({
                "user_id": uid,
                "full_name": u["full_name"],
                "display_name": u["full_name"],
                "role": u["role"],
                "department": "Engineering",
                "status": "active",
                "temp_password_used": False
            }, on_conflict="user_id").execute()
            print(f"Upserted profile for {u['role']}")
        except Exception as pe:
            print(f"Profile upsert error: {pe}")

# Seed employee-manager mapping
if "manager" in created_ids and "employee" in created_ids:
    try:
        supabase.table("employee_manager_map").upsert({
            "employee_id": created_ids["employee"],
            "manager_id": created_ids["manager"]
        }, on_conflict="employee_id").execute()
        print("Mapped employee -> manager successfully!")
    except Exception as me:
        print(f"Manager map err: {me}")

# Seed KRAs for employee
if "employee" in created_ids:
    emp_id = created_ids["employee"]
    kras_data = [
        {"user_id": emp_id, "name": "Stakeholder Management", "description": "Keep all key stakeholders, partners, and mentors aligned and informed.", "weight": 30, "color": "amber", "icon": "users", "category": "Communication", "frequency": "Weekly", "is_active": True},
        {"user_id": emp_id, "name": "Platform Architecture", "description": "Own end-to-end delivery of the new platform, APIs, and infrastructure.", "weight": 40, "color": "blue", "icon": "layers", "category": "Engineering", "frequency": "Weekly", "is_active": True},
        {"user_id": emp_id, "name": "Team Health", "description": "Ensure the team is motivated, unblocked, and growing through 1:1s and check-ins.", "weight": 30, "color": "green", "icon": "heart", "category": "Management", "frequency": "Monthly", "is_active": True},
    ]
    for k in kras_data:
        try:
            supabase.table("kras").upsert(k, on_conflict="user_id,name").execute()
            print(f"Seeded KRA: {k['name']}")
        except Exception as ke:
            print(f"KRA seed error: {ke}")

print("\nDatabase seed script ready!")
