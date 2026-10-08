-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enums
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('active', 'suspended', 'deleted');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE project_status AS ENUM ('active', 'at_risk', 'on_hold', 'completed', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE relationship_type AS ENUM ('manager', 'peer', 'report', 'customer', 'vendor', 'executive', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE session_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE capture_source AS ENUM ('chat', 'paste', 'manual');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE message_sender AS ENUM ('user', 'ai');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE daily_log_status AS ENUM ('draft', 'confirmed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE entry_type AS ENUM ('meeting', 'deliverable', 'documentation', 'learning', 'bug', 'feature', 'other');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE work_entry_status AS ENUM ('draft', 'confirmed', 'archived');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE stakeholder_engagement AS ENUM ('led', 'participated', 'informed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE report_type AS ENUM ('daily', 'weekly', 'custom');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE report_status AS ENUM ('generating', 'draft', 'ready', 'exported', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE export_format AS ENUM ('markdown', 'pdf');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE template_tone AS ENUM ('formal', 'neutral', 'concise');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE template_verbosity AS ENUM ('brief', 'standard', 'detailed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE notification_type AS ENUM ('insight', 'report_ready', 'reminder', 'system');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE integration_provider AS ENUM ('slack', 'jira', 'google_calendar', 'outlook', 'email');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE integration_status AS ENUM ('connected', 'disconnected', 'error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 4.1 Users (Mirroring Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(320) NOT NULL UNIQUE,
    status user_status NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- Trigger to automatically create a public.users row when a new auth.user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- 4.2 Profiles
CREATE TABLE IF NOT EXISTS public.profiles (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE UNIQUE,
    full_name VARCHAR(160),
    display_name VARCHAR(120),
    role VARCHAR(80) NOT NULL DEFAULT 'employee',
    department VARCHAR(120),
    status VARCHAR(40) NOT NULL DEFAULT 'active',
    temp_password_used BOOLEAN NOT NULL DEFAULT false,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    locale VARCHAR(10) NOT NULL DEFAULT 'en',
    avatar_url VARCHAR(2048),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger to automatically create a profile when a user is created
CREATE OR REPLACE FUNCTION public.handle_new_profile() 
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, full_name, role)
  VALUES (new.id, split_part(new.email, '@', 1), split_part(new.email, '@', 1), 'employee')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_public_user_created ON public.users;
CREATE TRIGGER on_public_user_created
  AFTER INSERT ON public.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_profile();

-- Employee-Manager Relationship Table
CREATE TABLE IF NOT EXISTS public.employee_manager_map (
    id BIGSERIAL PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    manager_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id)
);

-- 4.3 KRAs
CREATE TABLE IF NOT EXISTS public.kras (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    aliases TEXT[] NOT NULL DEFAULT '{}',
    priority SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    weight INTEGER NOT NULL DEFAULT 0,
    color VARCHAR(32) NOT NULL DEFAULT 'blue',
    icon VARCHAR(32) NOT NULL DEFAULT 'target',
    category VARCHAR(64) DEFAULT 'General',
    frequency VARCHAR(32) DEFAULT 'Weekly',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (user_id, name)
);

-- 4.4 Projects
CREATE TABLE IF NOT EXISTS public.projects (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    status project_status NOT NULL DEFAULT 'active',
    start_date DATE,
    end_date DATE,
    priority SMALLINT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (user_id, name)
);

-- 4.6 Stakeholders
CREATE TABLE IF NOT EXISTS public.stakeholders (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    role VARCHAR(120),
    organization VARCHAR(160),
    relationship_type relationship_type,
    contact VARCHAR(320),
    notes TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (user_id, name)
);

-- 4.9 Daily Logs (Per user per date in IST)
CREATE TABLE IF NOT EXISTS public.daily_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    log_date DATE NOT NULL,
    status daily_log_status NOT NULL DEFAULT 'draft',
    summary_ai TEXT,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, log_date)
);

-- 4.10 Work Entries
CREATE TABLE IF NOT EXISTS public.work_entries (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    daily_log_id BIGINT NOT NULL REFERENCES public.daily_logs(id) ON DELETE CASCADE,
    entry_type entry_type NOT NULL DEFAULT 'other',
    summary TEXT NOT NULL,
    details TEXT,
    kra_id BIGINT REFERENCES public.kras(id) ON DELETE SET NULL,
    project_id BIGINT REFERENCES public.projects(id) ON DELETE SET NULL,
    hours NUMERIC(6,3) DEFAULT 0.5,
    status work_entry_status NOT NULL DEFAULT 'draft',
    work_date DATE NOT NULL,
    mapping_reason TEXT,
    confidence_level VARCHAR(32) DEFAULT 'medium',
    is_ai_generated BOOLEAN NOT NULL DEFAULT false,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- Row Level Security (RLS)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_manager_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stakeholders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_entries ENABLE ROW LEVEL SECURITY;

-- Helper function to check if current user is manager of target employee
CREATE OR REPLACE FUNCTION public.is_manager_of(emp_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.employee_manager_map
    WHERE manager_id = auth.uid() AND employee_id = emp_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper function to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Users policies
DROP POLICY IF EXISTS "Users can view self or manager/admin" ON public.users;
CREATE POLICY "Users can view self or manager/admin" ON public.users
  FOR ALL USING (auth.uid() = id OR public.is_manager_of(id) OR public.is_admin());

-- Profiles policies
DROP POLICY IF EXISTS "Profiles viewable by self, manager, or admin" ON public.profiles;
CREATE POLICY "Profiles viewable by self, manager, or admin" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id OR public.is_manager_of(user_id) OR public.is_admin());

DROP POLICY IF EXISTS "Profiles updatable by self or admin" ON public.profiles;
CREATE POLICY "Profiles updatable by self or admin" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id OR public.is_admin());

DROP POLICY IF EXISTS "Profiles insertable by authenticated or admin" ON public.profiles;
CREATE POLICY "Profiles insertable by authenticated or admin" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id OR public.is_admin());

-- Employee-Manager Map policies
DROP POLICY IF EXISTS "Employee manager map viewable by participants or admin" ON public.employee_manager_map;
CREATE POLICY "Employee manager map viewable by participants or admin" ON public.employee_manager_map
  FOR SELECT USING (auth.uid() = manager_id OR auth.uid() = employee_id OR public.is_admin());

DROP POLICY IF EXISTS "Admin manage employee manager map" ON public.employee_manager_map;
CREATE POLICY "Admin manage employee manager map" ON public.employee_manager_map
  FOR ALL USING (public.is_admin());

-- KRAs policies (Self, or Manager of employee, or Admin)
DROP POLICY IF EXISTS "KRAs viewable by self, manager, admin" ON public.kras;
CREATE POLICY "KRAs viewable by self, manager, admin" ON public.kras
  FOR SELECT USING (auth.uid() = user_id OR public.is_manager_of(user_id) OR public.is_admin());

DROP POLICY IF EXISTS "KRAs editable by owner or admin" ON public.kras;
CREATE POLICY "KRAs editable by owner or admin" ON public.kras
  FOR ALL USING (auth.uid() = user_id OR public.is_admin());

-- Projects policies
DROP POLICY IF EXISTS "Projects owned by user" ON public.projects;
CREATE POLICY "Projects owned by user" ON public.projects
  FOR ALL USING (auth.uid() = user_id OR public.is_admin());

-- Daily Logs policies
DROP POLICY IF EXISTS "Daily logs viewable by self, manager, admin" ON public.daily_logs;
CREATE POLICY "Daily logs viewable by self, manager, admin" ON public.daily_logs
  FOR SELECT USING (auth.uid() = user_id OR public.is_manager_of(user_id) OR public.is_admin());

DROP POLICY IF EXISTS "Daily logs editable by owner" ON public.daily_logs;
CREATE POLICY "Daily logs editable by owner" ON public.daily_logs
  FOR ALL USING (auth.uid() = user_id OR public.is_admin());

-- Work entries policies (Enforces manager team isolation via RLS!)
DROP POLICY IF EXISTS "Work entries viewable by self, manager, admin" ON public.work_entries;
CREATE POLICY "Work entries viewable by self, manager, admin" ON public.work_entries
  FOR SELECT USING (auth.uid() = user_id OR public.is_manager_of(user_id) OR public.is_admin());

DROP POLICY IF EXISTS "Work entries editable by owner" ON public.work_entries;
CREATE POLICY "Work entries editable by owner" ON public.work_entries
  FOR ALL USING (auth.uid() = user_id OR public.is_admin());
