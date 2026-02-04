# Admin Errors Fix Plan

## Issues Identified
1. **Placeholder Image Error**: `GET https://via.placeholder.com/600x300 net::ERR_NAME_NOT_RESOLVED` - Fixed by replacing with `https://picsum.photos/600/300` in admin.html
2. **Missing Supabase Tables**: Several 404 errors for tables that don't exist in the database
3. **Missing Column**: 'status' column in 'deals' table causing 400 Bad Request

## Required Actions

### 1. Create Missing Tables in Supabase
Run these SQL commands in your Supabase SQL Editor:

```sql
-- Create feedback table
CREATE TABLE feedback (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    business_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create admin_followup_stats table
CREATE TABLE admin_followup_stats (
    business_id TEXT PRIMARY KEY,
    system_scheduled_month INTEGER DEFAULT 0,
    system_completed_month INTEGER DEFAULT 0,
    user_total INTEGER DEFAULT 0,
    user_completed INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add status column to deals table (if not exists)
ALTER TABLE deals ADD COLUMN IF NOT EXISTS status TEXT;
```

### 2. Enable Row Level Security (RLS) Policies
After creating tables, enable RLS and create policies:

```sql
-- Enable RLS
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_followup_stats ENABLE ROW LEVEL SECURITY;

-- Create policies for feedback
CREATE POLICY "Users can view feedback for their business" ON feedback
    FOR SELECT USING (auth.jwt() ->> 'business_id' = business_id);

CREATE POLICY "Users can insert feedback for their business" ON feedback
    FOR INSERT WITH CHECK (auth.jwt() ->> 'business_id' = business_id);

-- Create policies for admin_followup_stats
CREATE POLICY "Users can view admin stats for their business" ON admin_followup_stats
    FOR SELECT USING (auth.jwt() ->> 'business_id' = business_id);

CREATE POLICY "Users can update admin stats for their business" ON admin_followup_stats
    FOR UPDATE USING (auth.jwt() ->> 'business_id' = business_id);
```

### 3. Testing
After implementing:
- Reload the admin page
- Navigate to user explorer
- Check that overview, deals, followups tabs load without errors
- Verify placeholder images display correctly

## Status
- [x] Fixed placeholder images in admin.html
- [ ] Create missing tables in Supabase
- [ ] Enable RLS policies
- [ ] Test admin functionality

## Business Switching Fix

### Issues Identified
- When switching businesses, localStorage is updated but the database 'logins' table still has the old business_id
- On page reload, loadUserData queries for the new business_id but finds no record, clearing localStorage

### Required Actions
- [x] Modified loadUserData to query by both phone_number and business_id for accurate user-business record retrieval
- [x] Modified handleCreateBusiness to insert a new logins record for each new business instead of updating the existing one
- [x] Modified switchBusiness to check for and create missing login records for existing businesses before switching

### Testing
- Create a new business and verify a new login record is inserted
- Switch between businesses and ensure auto-login works without clearing localStorage
- Verify that each business has its own login session
